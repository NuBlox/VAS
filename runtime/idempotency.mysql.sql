-- v0.7: reservation and replay ledger for server workflow POSTs. Business writes,
-- result capture, and committed audit are atomic on a SINGLE MySQL connection.
-- Grant SELECT, INSERT, UPDATE specifically on this table to the runtime user;
-- DELETE and DDL privileges are not required.
CREATE TABLE IF NOT EXISTS `visual_studio_audit`.`vas_workflow_requests` (
  `project_id` VARCHAR(128) NOT NULL,
  `actor_id` VARCHAR(64) NOT NULL,
  `request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_id` VARCHAR(128) NOT NULL,
  `project_revision` CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` ENUM('pending','committed') NOT NULL,
  `result_json` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`project_id`,`actor_id`,`request_id`),
  INDEX `vas_workflow_requests_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
