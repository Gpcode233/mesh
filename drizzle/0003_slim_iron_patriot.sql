ALTER TABLE `policies` ADD `frozen_at` integer;--> statement-breakpoint
ALTER TABLE `policies` ADD `frozen_by_user_id` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `documents` text DEFAULT '[]' NOT NULL;