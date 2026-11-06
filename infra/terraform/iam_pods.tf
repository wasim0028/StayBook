# EKS Pod Identity: one IAM role per service, bound to its Kubernetes service account.
# Requires the eks-pod-identity-agent add-on on the cluster.
# Namespaces/service accounts must match the GitOps repo (apps/<group>/<app>/base/serviceaccount.yaml).

locals {
  table_arn   = aws_dynamodb_table.marketplace.arn
  table_index = "${aws_dynamodb_table.marketplace.arn}/index/*"

  # When an S3 gateway endpoint is given, server-side reads must come through it.
  # Uploads are NOT restricted this way: presigned POSTs are sent by browsers and phones over the
  # internet, but are authorised with the signing pod role, so a VPCE condition would break them.
  # (A for-expression avoids Terraform's "inconsistent conditional result types" error for {} vs object.)
  s3_vpce_condition_attr = {
    for k, v in { Condition = { StringEquals = { "aws:sourceVpce" = var.s3_vpc_endpoint_id } } } :
    k => v if var.s3_vpc_endpoint_id != ""
  }

  pod_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

# ---------- listing-svc (namespace host) ----------

resource "aws_iam_role" "listing_svc" {
  name               = "${local.name}-listing-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "listing_svc" {
  name = "listing-svc"
  role = aws_iam_role.listing_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:DescribeTable"]
        Resource = [local.table_arn, local.table_index]
      },
      {
        Sid      = "PresignPhotoUploads"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.photos.arn}/uploads/listings/*"
      },
      merge(
        {
          Sid      = "ConfirmPhotoUploads"
          Effect   = "Allow"
          Action   = "s3:GetObject" # HeadObject is authorised by s3:GetObject
          Resource = "${aws_s3_bucket.photos.arn}/uploads/listings/*"
        },
        local.s3_vpce_condition_attr
      ),
    ]
  })
}

resource "aws_eks_pod_identity_association" "listing_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "host"
  service_account = "listing-svc"
  role_arn        = aws_iam_role.listing_svc.arn
}

# ---------- search-svc (namespace guest): read-only ----------

resource "aws_iam_role" "search_svc" {
  name               = "${local.name}-search-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "search_svc" {
  name = "search-svc"
  role = aws_iam_role.search_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "TableReadOnly"
      Effect   = "Allow"
      Action   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:DescribeTable"]
      Resource = [local.table_arn, "${local.table_arn}/index/GSI3"]
    }]
  })
}

resource "aws_eks_pod_identity_association" "search_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "guest"
  service_account = "search-svc"
  role_arn        = aws_iam_role.search_svc.arn
}

# ---------- booking-svc (namespace guest): holds, orders, cancellations ----------

resource "aws_iam_role" "booking_svc" {
  name               = "${local.name}-booking-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "booking_svc" {
  name = "booking-svc"
  role = aws_iam_role.booking_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TableReadWrite"
        Effect = "Allow"
        # TransactWriteItems (reserve, attach order) is authorised per item through these actions.
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
          "dynamodb:ConditionCheckItem", "dynamodb:Query", "dynamodb:DescribeTable",
        ]
        Resource = [local.table_arn, "${local.table_arn}/index/GSI1", "${local.table_arn}/index/GSI2"]
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

resource "aws_eks_pod_identity_association" "booking_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "guest"
  service_account = "booking-svc"
  role_arn        = aws_iam_role.booking_svc.arn
}

# ---------- user-svc (namespace guest): profiles, wishlist, host onboarding ----------

resource "aws_iam_role" "user_svc" {
  name               = "${local.name}-user-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "user_svc" {
  name = "user-svc"
  role = aws_iam_role.user_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:DescribeTable"]
        Resource = local.table_arn
      },
      {
        Sid      = "PromoteToHost"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminAddUserToGroup"
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        Sid      = "RazorpayRouteKeys"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.razorpay.arn
      },
    ]
  })
}

resource "aws_eks_pod_identity_association" "user_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "guest"
  service_account = "user-svc"
  role_arn        = aws_iam_role.user_svc.arn
}

# ---------- review-svc (namespace guest) ----------

resource "aws_iam_role" "review_svc" {
  name               = "${local.name}-review-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "review_svc" {
  name = "review-svc"
  role = aws_iam_role.review_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "TableReadWrite"
      Effect = "Allow"
      # Review + guard + rating aggregate are written in one transaction (authorised per item).
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem", "dynamodb:Query", "dynamodb:DescribeTable"]
      Resource = local.table_arn
    }]
  })
}

resource "aws_eks_pod_identity_association" "review_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "guest"
  service_account = "review-svc"
  role_arn        = aws_iam_role.review_svc.arn
}

# ---------- message-svc (namespace guest): conversations ----------

resource "aws_iam_role" "message_svc" {
  name               = "${local.name}-message-svc"
  assume_role_policy = local.pod_trust
}

resource "aws_iam_role_policy" "message_svc" {
  name = "message-svc"
  role = aws_iam_role.message_svc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Reads listings/bookings/profiles; writes threads, messages, memberships, inbox counters, push tokens.
        Sid      = "TableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem", "dynamodb:Query", "dynamodb:DescribeTable"]
        Resource = [local.table_arn, "${local.table_arn}/index/GSI1"]
      },
    ]
  })
}

resource "aws_eks_pod_identity_association" "message_svc" {
  cluster_name    = var.eks_cluster_name
  namespace       = "guest"
  service_account = "message-svc"
  role_arn        = aws_iam_role.message_svc.arn
}
