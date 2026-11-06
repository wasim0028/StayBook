data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name       = "${var.project}-${var.env}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  is_prod    = var.env == "prod"
}
