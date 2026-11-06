# Users sign in with email. Every user starts in "guest"; user-svc moves them into "host"
# once Razorpay Route onboarding begins (AdminAddUserToGroup). "admin" is assigned by hand.
# Services read the groups from the `cognito:groups` claim of the ACCESS token.

resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = local.is_prod ? "ACTIVE" : "INACTIVE"
  mfa_configuration        = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  username_configuration {
    case_sensitive = false
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  dynamic "email_configuration" {
    for_each = var.ses_from_email == "" ? [] : [1]
    content {
      email_sending_account = "DEVELOPER"
      from_email_address    = var.ses_from_email
      source_arn            = "arn:${local.partition}:ses:${var.region}:${local.account_id}:identity/${var.ses_from_email}"
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your verification code"
    email_message        = "Your verification code is {####}"
  }

  lambda_config {
    post_confirmation = aws_lambda_function.cognito_post_confirmation.arn
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_group" "this" {
  for_each = {
    admin   = 1
    analyst = 2 # digital & sales team: read-only metrics in the admin console
    host    = 3
    guest   = 4
  }
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
  precedence   = each.value
  description  = "${each.key} users"
}

locals {
  cognito_client_common = {
    allowed_oauth_flows                  = ["code"]
    allowed_oauth_flows_user_pool_client = true
    allowed_oauth_scopes                 = ["openid", "email", "profile"]
    supported_identity_providers         = ["COGNITO"]
    explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  }
}

# Public clients (no secret) using Authorization Code + PKCE.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows                  = local.cognito_client_common.allowed_oauth_flows
  allowed_oauth_flows_user_pool_client = local.cognito_client_common.allowed_oauth_flows_user_pool_client
  allowed_oauth_scopes                 = local.cognito_client_common.allowed_oauth_scopes
  supported_identity_providers         = local.cognito_client_common.supported_identity_providers
  explicit_auth_flows                  = local.cognito_client_common.explicit_auth_flows
  callback_urls                        = var.web_callback_urls
  logout_urls                          = var.web_logout_urls

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_client" "mobile" {
  name         = "${local.name}-mobile"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows                  = local.cognito_client_common.allowed_oauth_flows
  allowed_oauth_flows_user_pool_client = local.cognito_client_common.allowed_oauth_flows_user_pool_client
  allowed_oauth_scopes                 = local.cognito_client_common.allowed_oauth_scopes
  supported_identity_providers         = local.cognito_client_common.supported_identity_providers
  explicit_auth_flows                  = local.cognito_client_common.explicit_auth_flows
  # expo-auth-session redirect: <scheme>://auth/callback (and the Expo Go proxy while developing)
  callback_urls = concat(["${var.mobile_scheme}://auth/callback"], local.is_prod ? [] : ["exp://127.0.0.1:8081/--/auth/callback"])
  logout_urls   = ["${var.mobile_scheme}://auth/logout"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 60
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# ---------- post-confirmation trigger: every new user joins "guest" ----------

data "archive_file" "cognito_post_confirmation" {
  type        = "zip"
  output_path = "${path.module}/.build/cognito-post-confirmation.zip"

  source {
    filename = "index.mjs"
    content  = <<-JS
      import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
      const client = new CognitoIdentityProviderClient({});
      export const handler = async (event) => {
        if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;
        await client.send(new AdminAddUserToGroupCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
          GroupName: "guest",
        }));
        return event;
      };
    JS
  }
}

resource "aws_iam_role" "cognito_post_confirmation" {
  name = "${local.name}-cognito-post-confirmation"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cognito_post_confirmation_logs" {
  role       = aws_iam_role.cognito_post_confirmation.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Attached to the role (not the function), so there is no pool -> lambda -> pool cycle.
resource "aws_iam_role_policy" "cognito_post_confirmation" {
  name = "add-to-guest-group"
  role = aws_iam_role.cognito_post_confirmation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "cognito-idp:AdminAddUserToGroup"
      Resource = aws_cognito_user_pool.main.arn
    }]
  })
}

resource "aws_lambda_function" "cognito_post_confirmation" {
  function_name    = "${local.name}-cognito-post-confirmation"
  role             = aws_iam_role.cognito_post_confirmation.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.cognito_post_confirmation.output_path
  source_code_hash = data.archive_file.cognito_post_confirmation.output_base64sha256
  timeout          = 5
  memory_size      = 128
}

resource "aws_lambda_permission" "cognito_post_confirmation" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_post_confirmation.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
