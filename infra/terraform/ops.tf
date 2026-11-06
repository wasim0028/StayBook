# Admin back office: the ops-indexer Lambda (stream -> staff queues + daily metrics) and admin-svc's pod role.

resource "aws_sqs_queue" "ops_indexer_dlq" {
  name                      = "${local.name}-ops-indexer-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_iam_role" "ops_indexer" {
  name               = "${local.name}-ops-indexer"
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy_attachment" "ops_indexer_basic" {
  role       = aws_iam_role.ops_indexer.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/${local.lambda_vpc ? "AWSLambdaVPCAccessExecutionRole" : "AWSLambdaBasicExecutionRole"}"
}

resource "aws_iam_role_policy" "ops_indexer" {
  name = "ops-indexer"
  role = aws_iam_role.ops_indexer.id
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
        # Writes only its own items: queue entries, metric counters and once-only marks.
        Sid      = "OwnItems"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.marketplace.arn
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["OPSQ#*", "METRIC#*", "OPSMARK#*"] }
        }
      },
      {
        Sid      = "DeadLetters"
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.ops_indexer_dlq.arn
      },
    ]
  })
}

resource "aws_lambda_function" "ops_indexer" {
  function_name    = local.lambda_fns.ops_indexer
  role             = aws_iam_role.ops_indexer.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256
  timeout          = 60
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.marketplace.name
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  dynamic "vpc_config" {
    for_each = local.lambda_vpc ? [1] : []
    content {
      subnet_ids         = var.lambda_subnet_ids # DynamoDB only: the gateway endpoint is enough
      security_group_ids = var.lambda_security_group_ids
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# Only the item types it indexes, so its own writes (OPSQ#, METRIC#, OPSMARK#) never invoke it.
resource "aws_lambda_event_source_mapping" "ops_indexer" {
  event_source_arn                   = aws_dynamodb_table.marketplace.stream_arn
  function_name                      = aws_lambda_function.ops_indexer.arn
  starting_position                  = "LATEST"
  batch_size                         = 50
  maximum_batching_window_in_seconds = 5
  maximum_retry_attempts             = 10
  maximum_record_age_in_seconds      = 21600
  bisect_batch_on_function_error     = false # order matters; the handler reports partial failures
  function_response_types            = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({ dynamodb = { Keys = { PK = { S = [{ prefix = "BOOKING#" }] }, SK = { S = ["META"] } } } })
    }
    filter {
      pattern = jsonencode({ dynamodb = { Keys = { PK = { S = [{ prefix = "LISTING#" }] }, SK = { S = ["META"] } } } })
    }
    filter {
      pattern = jsonencode({ dynamodb = { Keys = { PK = { S = [{ prefix = "USER#" }] }, SK = { S = ["PROFILE"] } } } })
    }
  }

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.ops_indexer_dlq.arn
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "ops_indexer_lag" {
  alarm_name          = "${local.name}-ops-indexer-iterator-age"
  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  dimensions          = { FunctionName = aws_lambda_function.ops_indexer.function_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 600000 # 10 minutes behind the table
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Admin queues and metrics are falling behind the table"
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "ops_indexer_dlq" {
  alarm_name          = "${local.name}-ops-indexer-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.ops_indexer_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Stream records were dropped by ops-indexer; admin queues or metrics may be incomplete"
  alarm_actions       = var.alarm_sns_topic_arn == "" ? [] : [var.alarm_sns_topic_arn]
}

# ---------- admin-svc (namespace admin) ----------

resource "aws_iam_role" "admin_svc" {
  name               = "${local.name}-admin-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "admin_svc" {
  name = "admin-svc"
  role = aws_iam_role.admin_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:DescribeTable"]
        Resource = [local.table_arn, "${local.table_arn}/index/GSI1", "${local.table_arn}/index/GSI2", "${local.table_arn}/index/GSI5"]
      },
      {
        Sid       = "WriteAuditLog"
        Effect    = "Allow"
        Action    = "dynamodb:PutItem"
        Resource  = local.table_arn
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["AUDIT#*"] } }
      },
      {
        Sid    = "UserDirectory"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers", "cognito-idp:AdminGetUser", "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut",
        ]
        Resource = aws_cognito_user_pool.main.arn
      },
    ]
  })
}

resource "aws_eks_pod_identity_association" "admin_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "admin"
  service_account = "admin-svc"
  role_arn        = aws_iam_role.admin_svc.arn
}
