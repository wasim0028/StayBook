# Listing photos.
#   uploads/listings/<listingId>/<photoId>              originals (private, presigned POST from clients)
#   listings/<listingId>/<photoId>/w{360,720,1280}.webp  resized by image-processor, served by CloudFront
# CloudFront can read only listings/*; uploads/* is never public.

resource "aws_s3_bucket" "photos" {
  bucket        = "${local.name}-photos-${local.account_id}"
  force_destroy = !local.is_prod
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3 keeps CloudFront OAC simple; SSE-KMS needs a key policy grant
    }
  }
}

resource "aws_s3_bucket_versioning" "photos" {
  bucket = aws_s3_bucket.photos.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    id     = "originals-to-ia"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
  }

  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.photos]
}

# Browsers POST straight to S3 with the presigned form from listing-svc.
resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = var.web_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_cloudfront_origin_access_control" "photos" {
  name                              = "${local.name}-photos"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name} listing photos"
  price_class     = "PriceClass_200" # includes India edge locations
  http_version    = "http2and3"
  aliases         = var.cdn_domain == "" ? [] : [var.cdn_domain]

  origin {
    origin_id                = "photos"
    domain_name              = aws_s3_bucket.photos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.photos.id
  }

  # Only resized images are reachable.
  ordered_cache_behavior {
    path_pattern               = "/listings/*"
    target_origin_id           = "photos"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false # WebP is already compressed
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  # Everything else (including /uploads/*) is denied by the bucket policy and returns 403.
  default_cache_behavior {
    target_origin_id       = "photos"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.cdn_domain == ""
    acm_certificate_arn            = var.cdn_domain == "" ? null : var.cdn_acm_certificate_arn
    ssl_support_method             = var.cdn_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.cdn_domain == "" ? "TLSv1" : "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = var.cdn_domain == "" || var.cdn_acm_certificate_arn != ""
      error_message = "cdn_acm_certificate_arn (us-east-1) is required when cdn_domain is set."
    }
  }
}

resource "aws_s3_bucket_policy" "photos" {
  bucket = aws_s3_bucket.photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReadResizedOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.photos.arn}/listings/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.photos.arn, "${aws_s3_bucket.photos.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.photos]
}
