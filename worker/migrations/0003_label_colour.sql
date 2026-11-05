-- Hand-written: the generated migration rebuilt `labels` with DROP TABLE, which is needless for one column.
ALTER TABLE `labels` ADD `color` text CONSTRAINT "labels_color_check" CHECK(color IN ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'brown'));
