variable "project" {
  description = "Short name used as a prefix for every resource."
  type        = string
  default     = "marketplace"
}

variable "env" {
  description = "Environment name: dev, staging or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging or prod."
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "github_org" {
  description = "GitHub organisation or user that owns the repositories."
  type        = string
}

variable "app_repo" {
  description = "Application source repository name (Repo A)."
  type        = string
  default     = "marketplace-app"
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider. Set false if another stack already created it."
  type        = bool
  default     = true
}

variable "eks_cluster_name" {
  description = "Existing EKS cluster (from the VPC/EKS stack). Pod Identity associations attach to it."
  type        = string
}

variable "s3_vpc_endpoint_id" {
  description = "Optional S3 gateway endpoint ID. When set, pod roles may only reach the photos bucket through it."
  type        = string
  default     = ""
}

variable "services" {
  description = "Container services that get an ECR repository."
  type        = set(string)
  default     = ["web", "listing-svc", "search-svc", "booking-svc", "user-svc", "review-svc", "message-svc", "admin-svc"]
}

variable "web_origins" {
  description = "Browser origins allowed to upload photos directly to S3 and to use Cognito callbacks."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "web_callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/auth/callback"]
}

variable "web_logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000/"]
}

variable "mobile_scheme" {
  description = "Deep-link scheme registered by the Expo app (app.json `scheme`)."
  type        = string
  default     = "staybook"
}

variable "cognito_domain_prefix" {
  description = "Prefix for the Cognito hosted UI domain (<prefix>.auth.<region>.amazoncognito.com). Must be globally unique."
  type        = string
}

variable "cdn_domain" {
  description = "Optional custom domain for the image CDN, e.g. img.example.in. Leave empty to use the cloudfront.net name."
  type        = string
  default     = ""
}

variable "cdn_acm_certificate_arn" {
  description = "ACM certificate in us-east-1 for cdn_domain. Required when cdn_domain is set."
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "Verified SES identity used for Cognito emails and booking notifications. Empty uses the Cognito default sender (50 emails/day limit) and keeps booking emails switched off."
  type        = string
  default     = ""
}

variable "lambda_subnet_ids" {
  description = "Optional private subnets (with NAT) for the Lambdas. Empty runs them outside the VPC, which still reaches DynamoDB and Razorpay."
  type        = list(string)
  default     = []
}

variable "lambda_security_group_ids" {
  description = "Security groups for the Lambdas when lambda_subnet_ids is set (egress 443 only)."
  type        = list(string)
  default     = []
}

variable "alarm_sns_topic_arn" {
  description = "Optional SNS topic for payment alarms."
  type        = string
  default     = ""
}

variable "enable_photo_moderation" {
  description = "Run Amazon Rekognition moderation on every uploaded listing photo. Unsafe images are rejected."
  type        = bool
  default     = true
}
