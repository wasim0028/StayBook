bucket       = "your-org-terraform-state-ap-south-1"
key          = "marketplace/dev/app-data.tfstate"
region       = "ap-south-1"
encrypt      = true
use_lockfile = true # native S3 state locking (Terraform >= 1.10), no DynamoDB lock table needed
