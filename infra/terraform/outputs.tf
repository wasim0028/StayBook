output "table_name" {
  value = aws_dynamodb_table.marketplace.name
}

output "table_stream_arn" {
  description = "Wire booking-confirmation / review-publisher Lambdas to this."
  value       = aws_dynamodb_table.marketplace.stream_arn
}

output "photos_bucket" {
  value = aws_s3_bucket.photos.bucket
}

output "cdn_base_url" {
  description = "Set as CDN_BASE_URL on listing-svc and search-svc, and EXPO_PUBLIC_CDN_URL in the mobile app."
  value       = var.cdn_domain == "" ? "https://${aws_cloudfront_distribution.cdn.domain_name}" : "https://${var.cdn_domain}"
}

output "cdn_distribution_domain" {
  description = "CNAME target when using a custom cdn_domain."
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_ids" {
  description = "Comma-separated; set as COGNITO_CLIENT_IDS on the services."
  value       = join(",", [aws_cognito_user_pool_client.web.id, aws_cognito_user_pool_client.mobile.id])
}

output "cognito_mobile_client_id" {
  value = aws_cognito_user_pool_client.mobile.id
}

output "cognito_hosted_ui_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}

output "ecr_registry" {
  value = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "github_ci_role_arn" {
  description = "Store as the AWS_ROLE_ARN repository variable in Repo A."
  value       = aws_iam_role.github_ci.arn
}

output "pod_role_arns" {
  value = {
    listing_svc = aws_iam_role.listing_svc.arn
    search_svc  = aws_iam_role.search_svc.arn
    booking_svc = aws_iam_role.booking_svc.arn
    user_svc    = aws_iam_role.user_svc.arn
    review_svc  = aws_iam_role.review_svc.arn
    admin_svc   = aws_iam_role.admin_svc.arn
    message_svc = aws_iam_role.message_svc.arn
  }
}

output "razorpay_secret_arn" {
  description = "Put the Razorpay JSON here; set as RAZORPAY_SECRET_ID on booking-svc."
  value       = aws_secretsmanager_secret.razorpay.arn
}

output "payment_webhook_url" {
  description = "Paste into Razorpay Dashboard > Webhooks (events: payment.captured, payment.failed, refund.processed, refund.failed, account.under_review, account.needs_clarification, account.activated, account.rejected, account.suspended)."
  value       = aws_lambda_function_url.payment_webhook.function_url
}

output "lambda_function_names" {
  value = local.lambda_fns
}
