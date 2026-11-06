# ---------- Razorpay credentials ----------
# Terraform creates the empty secret; set the value once, outside Terraform, so keys never enter state:
#   aws secretsmanager put-secret-value --secret-id <razorpay_secret_arn> \
#     --secret-string '{"key_id":"rzp_test_...","key_secret":"...","webhook_secret":"..."}'

resource "aws_secretsmanager_secret" "razorpay" {
  name                    = "${local.name}/razorpay"
  description             = "Razorpay API key id/secret and webhook secret (JSON)"
  recovery_window_in_days = local.is_prod ? 30 : 0
}

# ---------- Lambda code placeholder ----------
# Terraform owns configuration; lambda-deploy.yaml owns the code (update-function-code).
# The placeholder fails loudly if invoked before the first deploy.

data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/lambda-placeholder.zip"
  source {
    filename = "index.js"
    content  = "exports.handler = async () => { throw new Error('code not deployed yet: run lambda-deploy'); };"
  }
}

locals {
  lambda_vpc = length(var.lambda_subnet_ids) > 0
  lambda_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  lambda_fns = {
    payment_webhook  = "${local.name}-payment-webhook"
    hold_expirer     = "${local.name}-hold-expirer"
    image_processor  = "${local.name}-image-processor"
    booking_notifier = "${local.name}-booking-notifier"
    ops_indexer      = "${local.name}-ops-indexer"
    host_evaluator   = "${local.name}-host-evaluator"
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_fns
  name              = "/aws/lambda/${each.value}"
  retention_in_days = local.is_prod ? 90 : 14
}

# ---------- payment-webhook ----------

resource "aws_iam_role" "payment_webhook" {
  name               = "${local.name}-payment-webhook"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "payment_webhook_basic" {
  role       = aws_iam_role.payment_webhook.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/${local.lambda_vpc ? "AWSLambdaVPCAccessExecutionRole" : "AWSLambdaBasicExecutionRole"}"
}

resource "aws_iam_role_policy" "payment_webhook" {
  name = "payment-webhook"
  role = aws_iam_role.payment_webhook.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConfirmAndRefund"
        Effect = "Allow"
        # TransactWriteItems is authorised per item through these actions.
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"]
        Resource = aws_dynamodb_table.marketplace.arn
      },
      {
        Sid      = "RazorpaySecret"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.razorpay.arn
      },
    ]
  })
}

resource "aws_lambda_function" "payment_webhook" {
  function_name    = local.lambda_fns.payment_webhook
  role             = aws_iam_role.payment_webhook.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  timeout          = 15 # Razorpay waits ~5s; refunds and DynamoDB retries fit comfortably
  memory_size      = 512
  # Caps concurrent writers during a webhook storm; Razorpay retries anything throttled.
  reserved_concurrent_executions = 50

  environment {
    variables = {
      TABLE_NAME                          = aws_dynamodb_table.marketplace.name
      RAZORPAY_SECRET_ID                  = aws_secretsmanager_secret.razorpay.arn
      NODE_OPTIONS                        = "--enable-source-maps"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  dynamic "vpc_config" {
    for_each = local.lambda_vpc ? [1] : []
    content {
      # Must reach api.razorpay.com: use private subnets with a NAT gateway.
      subnet_ids         = var.lambda_subnet_ids
      security_group_ids = var.lambda_security_group_ids
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# Razorpay can't sign requests with SigV4, so the URL is public and the HMAC check in the handler is the auth.
resource "aws_lambda_function_url" "payment_webhook" {
  function_name      = aws_lambda_function.payment_webhook.function_name
  authorization_type = "NONE"
}

# ---------- hold-expirer ----------

resource "aws_iam_role" "hold_expirer" {
  name               = "${local.name}-hold-expirer"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "hold_expirer_basic" {
  role       = aws_iam_role.hold_expirer.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/${local.lambda_vpc ? "AWSLambdaVPCAccessExecutionRole" : "AWSLambdaBasicExecutionRole"}"
}

resource "aws_iam_role_policy" "hold_expirer" {
  name = "hold-expirer"
  role = aws_iam_role.hold_expirer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadHoldIndex"
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = "${aws_dynamodb_table.marketplace.arn}/index/GSI4"
      },
      {
        Sid      = "ExpireAndRelease"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.marketplace.arn
      },
    ]
  })
}

resource "aws_lambda_function" "hold_expirer" {
  function_name                  = local.lambda_fns.hold_expirer
  role                           = aws_iam_role.hold_expirer.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = data.archive_file.lambda_placeholder.output_path
  source_code_hash               = data.archive_file.lambda_placeholder.output_base64sha256
  timeout                        = 55 # finishes before the next minute's run
  memory_size                    = 256
  reserved_concurrent_executions = 1 # never overlap runs

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.marketplace.name
      GRACE_SECONDS = "300"
      MAX_PER_RUN   = "500"
      NODE_OPTIONS  = "--enable-source-maps"
    }
  }

  dynamic "vpc_config" {
    for_each = local.lambda_vpc ? [1] : []
    content {
      subnet_ids         = var.lambda_subnet_ids
      security_group_ids = var.lambda_security_group_ids
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-hold-expirer"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = [aws_lambda_function.hold_expirer.arn, aws_lambda_function.host_evaluator.arn]
    }]
  })
}

resource "aws_scheduler_schedule" "hold_expirer" {
  name                = "${local.name}-hold-expirer"
  schedule_expression = "rate(1 minute)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.hold_expirer.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts       = 0 # the next run a minute later is the retry
      maximum_event_age_in_seconds = 60
    }
  }
}

# ---------- alarm: any webhook error means a payment may be stuck ----------

resource "aws_cloudwatch_metric_alarm" "payment_webhook_errors" {
  alarm_name          = "${local.name}-payment-webhook-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.payment_webhook.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "payment-webhook returned errors; Razorpay will retry, but check logs for refund failures"
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}
