CREATE INDEX `mail_outbox_due_idx` ON `mail_outbox` (`next_attempt`) WHERE "mail_outbox"."sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX `runs_queue_idx` ON `runs` (`workspace_id`,`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_active_idx` ON `runs` (`workspace_id`,`status`);