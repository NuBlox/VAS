-- Apply only to the local VAS development database after reviewing the schema.
-- First create the separate `visual_studio_audit` database as administrator.
-- Grant only SELECT and INSERT on this table to the VAS application user.
CREATE TABLE IF NOT EXISTS `visual_studio_audit`.`vas_audit_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `actor_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `resource_type` VARCHAR(32) NOT NULL,
  `resource_id` VARCHAR(128) NOT NULL,
  `outcome` VARCHAR(16) NOT NULL,
  `project_id` VARCHAR(128) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `vas_audit_actor_created` (`actor_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
