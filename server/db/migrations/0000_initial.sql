CREATE TABLE `action_test_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`version_id` text NOT NULL,
	`number` integer NOT NULL,
	`cases` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `action_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_test_suites_version_id_number_unique` ON `action_test_suites` (`version_id`,`number`);--> statement-breakpoint
CREATE TABLE `action_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`action_id` text NOT NULL,
	`number` integer NOT NULL,
	`source` text NOT NULL,
	`input_schema` text DEFAULT '{}' NOT NULL,
	`output_schema` text DEFAULT '{}' NOT NULL,
	`validation_mode` text DEFAULT 'legacy' NOT NULL,
	`sdk_contract` text DEFAULT '{}' NOT NULL,
	`promoted_from` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promoted_from`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_versions_action_id_number_unique` ON `action_versions` (`action_id`,`number`);--> statement-breakpoint
CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`action_id` text NOT NULL,
	`actor_id` integer NOT NULL,
	`cron` text NOT NULL,
	`inputs` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`next_run_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`webhook_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`outcome` text NOT NULL,
	`run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_webhook_id_delivery_id_unique` ON `webhook_deliveries` (`webhook_id`,`delivery_id`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`action_version_id` text NOT NULL,
	`actor_id` integer NOT NULL,
	`secret_hash` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`rotated_at` text NOT NULL,
	`last_received_at` text,
	`last_accepted_at` text,
	`last_rejection` text DEFAULT '' NOT NULL,
	`last_rejected_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_version_id`) REFERENCES `action_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_digest` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`revoked_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_role_check" CHECK("invitations"."role" IN ('admin','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_pending_invitation` ON `invitations` (`workspace_id`,"email" COLLATE NOCASE) WHERE "invitations"."accepted_at" IS NULL AND "invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_digest_unique` ON `invitations` (`token_digest`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memberships_role_check" CHECK("memberships"."role" IN ('owner','admin','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_workspace_owner` ON `memberships` (`workspace_id`) WHERE "memberships"."role"='owner';--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_workspace_id_user_id_unique` ON `memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`pending_user_id` integer,
	`workspace_id` integer,
	`expires_at` integer NOT NULL,
	`reauthenticated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pending_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`totp_secret` text,
	`pending_totp_secret` text,
	`totp_last_counter` integer,
	`recovery_codes` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` ("email" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` ("username" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_host_unique` ON `workspaces` ("host" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `table_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`table_id` text NOT NULL,
	`values` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `workspace_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`columns` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer NOT NULL,
	`lease_until` integer,
	`sent_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `oauth_attempts` (
	`state_digest` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`plugin_id` text NOT NULL,
	`session_id` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`digest` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`credential_id` text,
	`configuration` text DEFAULT '{}' NOT NULL,
	`release_metadata` text DEFAULT '{}' NOT NULL,
	`package_url` text DEFAULT '' NOT NULL,
	`distribution` text DEFAULT 'inline' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_project_id_slug_unique` ON `plugins` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `executors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`pool` text DEFAULT 'shared' NOT NULL,
	`token_hash` text NOT NULL,
	`registration_nonce` text NOT NULL,
	`locally_managed` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`protocol_version` integer DEFAULT 1 NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `executors_token_hash_unique` ON `executors` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `executors_name_unique` ON `executors` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `executors_project_id_unique` ON `executors` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`readable_tables` text DEFAULT '[]' NOT NULL,
	`writable_tables` text DEFAULT '[]' NOT NULL,
	`readable_documents` text DEFAULT '[]' NOT NULL,
	`writable_documents` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`execution_pool` text DEFAULT 'shared' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`max_concurrent_runs` integer DEFAULT 4 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_settings_workspace_id_unique` ON `workspace_settings` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`media_type` text DEFAULT 'text/plain' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_id_sequence_unique` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` integer NOT NULL,
	`token_id` text,
	`action_version_id` text,
	`operation` text NOT NULL,
	`origin` text DEFAULT 'browser' NOT NULL,
	`origin_reference` text DEFAULT '' NOT NULL,
	`inputs` text DEFAULT '{}' NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`output` text DEFAULT '{}' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`idempotency_namespace` text DEFAULT '' NOT NULL,
	`retry_of` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`executor_id` text,
	`lease_expires_at` text,
	`deadline` text,
	`capability_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`token_id`) REFERENCES `access_tokens`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`action_version_id`) REFERENCES `action_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retry_of`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`executor_id`) REFERENCES `executors`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "runs_status_check" CHECK("runs"."status" in ('queued','running','waiting_approval','succeeded','failed','cancelled','interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_workspace_id_idempotency_namespace_idempotency_key_unique` ON `runs` (`workspace_id`,`idempotency_namespace`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`name` text NOT NULL,
	`digest` text NOT NULL,
	`scopes` text NOT NULL,
	`projects` text DEFAULT '[]' NOT NULL,
	`action_versions` text DEFAULT '[]' NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`first_used_at` text,
	`last_used_at` text,
	`request_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`rest_request_count` integer DEFAULT 0 NOT NULL,
	`mcp_request_count` integer DEFAULT 0 NOT NULL,
	`last_transport` text DEFAULT '' NOT NULL,
	`last_outcome` text DEFAULT '' NOT NULL,
	`last_status_code` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tokens_digest_unique` ON `access_tokens` (`digest`);