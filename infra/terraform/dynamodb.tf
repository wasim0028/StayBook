# Single table for the whole marketplace. Key formats live in packages/shared/src/keys.ts;
# packages/test-utils creates the same schema for integration tests. Keep all three in sync.

resource "aws_dynamodb_table" "marketplace" {
  name         = "${local.name}-marketplace"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  deletion_protection_enabled = local.is_prod

  # Stream consumers: booking-notifier and ops-indexer. DynamoDB Streams serves at most two Lambda
  # consumers per shard well; a third (e.g. a data-lake writer) should go through Kinesis Data Streams.
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI5PK"
    type = "S"
  }
  attribute {
    name = "GSI5SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }
  attribute {
    name = "GSI3PK"
    type = "S"
  }
  attribute {
    name = "GSI3SK"
    type = "S"
  }
  attribute {
    name = "GSI4PK"
    type = "S"
  }
  attribute {
    name = "GSI4SK"
    type = "S"
  }

  # Guest trips: GUEST#<id> / BOOKING#<createdAt>
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # Host dashboard: HOST#<id> / LISTING#<id> | BOOKING#<ts>
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # Map search: GEO#<geohash5> / PRICE#<paise>#<id>. Sparse: only PUBLISHED listings carry these keys.
  # INCLUDE keeps the index small; these are exactly the fields search-svc filters on and returns.
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "GSI3PK"
    range_key       = "GSI3SK"
    projection_type = "INCLUDE"
    non_key_attributes = [
      "id", "title", "propertyType", "city", "lat", "lng", "basePricePaise",
      "maxGuests", "bedrooms", "amenities", "coverPhotoId", "ratingAvg", "ratingCount", "status",
      # filters and stay pricing (search shows the full price, so it needs the fee rules)
      "beds", "bathrooms", "cleaningFeePaise", "weeklyDiscountPct", "monthlyDiscountPct",
      "minNights", "maxNights", "guestsIncluded", "extraGuestFeePaise", "instantBook", "hostSuperhost",
    ]
  }

  # Unpaid holds: HOLD#<0-7> / <holdExpiresAt>#<bookingId>. Sparse (PENDING_PAYMENT only), read by hold-expirer.
  global_secondary_index {
    name            = "GSI4"
    hash_key        = "GSI4PK"
    range_key       = "GSI4SK"
    projection_type = "KEYS_ONLY"
  }

  # Staff work queues: only OPSQ# items written by ops-indexer carry these keys. Entries are small.
  global_secondary_index {
    name            = "GSI5"
    hash_key        = "GSI5PK"
    range_key       = "GSI5SK"
    projection_type = "ALL"
  }

  # Night items, idempotency keys and processed-webhook markers expire automatically.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true # AWS-managed KMS key; pass kms_key_arn for a CMK
  }

  lifecycle {
    prevent_destroy = false # flip to true for prod once the stack is stable
  }
}
