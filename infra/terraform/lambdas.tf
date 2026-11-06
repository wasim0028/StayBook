# image-processor (S3 upload -> renditions) and booking-notifier (DynamoDB stream -> email).
# Same convention as payments.tf: Terraform owns configuration, lambda-deploy.yaml owns code.

# ---------- image-processor ----------

resource "aws_iam_role" "image_processor" {
  name               = "${local.name}-image-processor"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "image_processor_basic" {
  role       = aws_iam_role.image_processor.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "image_processor" {
  name = "image-processor"
  role = aws_iam_role.image_processor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "ReadAndDiscardUploads"
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:DeleteObject"]
          Resource = "${aws_s3_bucket.photos.arn}/uploads/listings/*"
        },
        {
          Sid      = "WriteRenditions"
          Effect   = "Allow"
          Action   = "s3:PutObject"
          Resource = "${aws_s3_bucket.photos.arn}/listings/*"
        },
      ],
      var.enable_photo_moderation ? [{
        Sid      = "Moderate"
        Effect   = "Allow"
        Action   = "rekognition:DetectModerationLabels"
        Resource = "*"
      }] : [],
    )
  })
}

# Not in the VPC: it only talks to S3 and Rekognition, and a VPC would need a NAT for Rekognition.
resource "aws_lambda_function" "image_processor" {
  function_name    = local.lambda_fns.image_processor
  role             = aws_iam_role.image_processor.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"] # function.zip bundles sharp's linux-arm64 binaries
  handler          = "index.handler"
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  timeout          = 60
  memory_size      = 1536 # sharp on 12 MP photos; more memory also means more CPU
  # Keeps a bulk upload from starving the account's concurrency; S3 retries throttled invocations.
  reserved_concurrent_executions = 20

  environment {
    variables = {
      ENABLE_MODERATION = tostring(var.enable_photo_moderation)
      NODE_OPTIONS      = "--enable-source-maps"
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_permission" "image_processor_s3" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.image_processor.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.photos.arn
  source_account = local.account_id
}

resource "aws_s3_bucket_notification" "photos" {
  bucket = aws_s3_bucket.photos.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.image_processor.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/listings/"
  }

  depends_on = [aws_lambda_permission.image_processor_s3]
}

# ---------- booking-notifier ----------

resource "aws_sqs_queue" "notifier_dlq" {
  name                      = "${local.name}-booking-notifier-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

resource "aws_iam_role" "booking_notifier" {
  name               = "${local.name}-booking-notifier"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "booking_notifier_basic" {
  role       = aws_iam_role.booking_notifier.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/${local.lambda_vpc ? "AWSLambdaVPCAccessExecutionRole" : "AWSLambdaBasicExecutionRole"}"
}

resource "aws_iam_role_policy" "booking_notifier" {
  name = "booking-notifier"
  role = aws_iam_role.booking_notifier.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadStream"
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"]
        Resource = aws_dynamodb_table.marketplace.stream_arn
      },
      {
        Sid      = "SendOnceMarkersAndPushTokens"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.marketplace.arn
      },
      {
        Sid      = "LookUpEmail"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminGetUser"
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        Sid      = "SendEmail"
        Effect   = "Allow"
        Action   = "ses:SendEmail"
        Resource = "arn:${local.partition}:ses:${var.region}:${local.account_id}:identity/*"
      },
      {
        Sid      = "DeadLetters"
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.notifier_dlq.arn
      },
    ]
  })
}

resource "aws_lambda_function" "booking_notifier" {
  function_name    = local.lambda_fns.booking_notifier
  role             = aws_iam_role.booking_notifier.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.marketplace.name
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      EMAIL_FROM           = var.ses_from_email == "" ? "unset@invalid" : var.ses_from_email # unset = push only
      NODE_OPTIONS         = "--enable-source-maps"
    }
  }

  dynamic "vpc_config" {
    for_each = local.lambda_vpc ? [1] : []
    content {
      # Needs SES, Cognito and DynamoDB: private subnets with a NAT gateway (or interface endpoints).
      subnet_ids         = var.lambda_subnet_ids
      security_group_ids = var.lambda_security_group_ids
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# Booking changes (emails, when a verified SES sender is set) and new chat messages (push, always).
resource "aws_lambda_event_source_mapping" "booking_notifier" {
  event_source_arn                   = aws_dynamodb_table.marketplace.stream_arn
  function_name                      = aws_lambda_function.booking_notifier.arn
  starting_position                  = "LATEST"
  batch_size                         = 10
  maximum_batching_window_in_seconds = 2
  maximum_retry_attempts             = 5
  maximum_record_age_in_seconds      = 3600
  function_response_types            = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["MODIFY"]
        dynamodb = {
          Keys = {
            PK = { S = [{ prefix = "BOOKING#" }] }
            SK = { S = ["META"] }
          }
        }
      })
    }
    filter {
      # New booking requests (request to book) notify the host as soon as they're created.
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb = {
          Keys     = { PK = { S = [{ prefix = "BOOKING#" }] }, SK = { S = ["META"] } }
          NewImage = { status = { S = ["REQUESTED"] } }
        }
      })
    }
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb = {
          Keys = {
            PK = { S = [{ prefix = "THREAD#" }] }
            SK = { S = [{ prefix = "MSG#" }] }
          }
        }
      })
    }
  }

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.notifier_dlq.arn
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "notifier_dlq" {
  alarm_name          = "${local.name}-booking-notifier-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.notifier_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Booking emails failed after all retries; inspect the dead-letter queue"
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}
