CREATE TABLE `shell_rules` (
	`plugin_id` text NOT NULL,
	`executable` text NOT NULL,
	`decision` text NOT NULL,
	PRIMARY KEY(`plugin_id`, `executable`),
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `approvals` ADD `shell` text;