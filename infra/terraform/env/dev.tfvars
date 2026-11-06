env                   = "dev"
github_org            = "your-org"
eks_cluster_name      = "marketplace-dev"
cognito_domain_prefix = "marketplace-dev-yourorg" # must be globally unique

web_origins       = ["http://localhost:3000", "https://dev.example.in"]
web_callback_urls = ["http://localhost:3000/auth/callback", "https://dev.example.in/auth/callback"]
web_logout_urls   = ["http://localhost:3000/", "https://dev.example.in/"]

# s3_vpc_endpoint_id = "vpce-0123456789abcdef0"   # from the VPC stack
