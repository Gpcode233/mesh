ALTER TABLE `milestones` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `milestones` ADD `amount_yocto` text;--> statement-breakpoint
ALTER TABLE `settlements` ADD `kind` text DEFAULT 'milestone_payout' NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `amount_yocto` text;--> statement-breakpoint
ALTER TABLE `settlements` ADD `submitted_tx_hash` text;--> statement-breakpoint
ALTER TABLE `settlements` ADD `error` text;