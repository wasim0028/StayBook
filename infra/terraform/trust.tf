# Daily Superhost evaluation (lambdas/host-evaluator).

resource "aws_iam_role" "host_evaluator" {
  name               = "${local.name}-host-evaluator"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "host_evaluator_basic" {
  role       = aws_iam_role.host_evaluator.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/${local.lambda_vpc ? "AWSLambdaVPCAccessExecutionRole" : "AWSLambdaBasicExecutionRole"}"
}

resource "aws_iam_role_policy" "host_evaluator" {
  name = "host-evaluator"
  role = aws_iam_role.host_evaluator.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadHostsBookingsListings"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [local.table_arn, "${local.table_arn}/index/GSI2", "${local.table_arn}/index/GSI5"]
      },
      {
        # Writes the Superhost result on profiles (USER#) and the badge on listings (LISTING#) only.
        Sid       = "WriteBadges"
        Effect    = "Allow"
        Action    = "dynamodb:UpdateItem"
        Resource  = local.table_arn
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["USER#*", "LISTING#*"] } }
      },
    ]
  })
}

resource "aws_lambda_function" "host_evaluator" {
  function_name                  = local.lambda_fns.host_evaluator
  role                           = aws_iam_role.host_evaluator.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = data.archive_file.lambda_placeholder.output_path
  source_code_hash               = data.archive_file.lambda_placeholder.output_base64sha256
  timeout                        = 900 # one pass over every active host
  memory_size                    = 512
  reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.marketplace.name
      NODE_OPTIONS = "--enable-source-maps"
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

resource "aws_scheduler_schedule" "host_evaluator" {
  name                         = "${local.name}-host-evaluator"
  schedule_expression          = "cron(30 2 * * ? *)" # 08:00 IST daily
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.host_evaluator.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}
