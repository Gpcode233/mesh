CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`requested_by_agent` text NOT NULL,
	`requested_by_user_id` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_user_id` text,
	`decided_at` integer,
	`result_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approvals_org` ON `approvals` (`org_id`,`status`);--> statement-breakpoint
DROP INDEX `bids_rfq`;--> statement-breakpoint
CREATE UNIQUE INDEX `bids_rfq_supplier` ON `bids` (`rfq_id`,`supplier_id`);--> statement-breakpoint
DROP INDEX `suppliers_org`;--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_org_name` ON `suppliers` (`org_id`,`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rfqs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by_user_id` text,
	`resource` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`max_budget_cents` integer NOT NULL,
	`deadline` text NOT NULL,
	`destination` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_rfqs`("id", "org_id", "created_by_user_id", "resource", "quantity", "unit", "max_budget_cents", "deadline", "destination", "status", "created_at") SELECT "id", "org_id", "created_by_user_id", "resource", "quantity", "unit", "max_budget_cents", "deadline", "destination", "status", "created_at" FROM `rfqs`;--> statement-breakpoint
DROP TABLE `rfqs`;--> statement-breakpoint
ALTER TABLE `__new_rfqs` RENAME TO `rfqs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rfqs_org` ON `rfqs` (`org_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `approval_id` text REFERENCES approvals(id);