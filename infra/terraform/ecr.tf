resource "aws_ecr_repository" "svc" {
  for_each = var.services

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE" # a short SHA always means the same image
  force_delete         = !local.is_prod

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Drop untagged layers after 3 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 3
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the newest 100 tagged images (rollback window)"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 100
        }
        action = { type = "expire" }
      },
    ]
  })
}
