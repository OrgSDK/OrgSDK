CREATE TABLE `mcp_connections` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`workspace_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`transport` text DEFAULT 'auto' NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`catalogue` text DEFAULT '[]' NOT NULL,
	`enabled_tools` text DEFAULT '[]' NOT NULL,
	`aliases` text DEFAULT '{}' NOT NULL,
	`candidate` text,
	`discovery_run_id` text,
	`status` text DEFAULT 'unchecked' NOT NULL,
	`checked_at` text,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
