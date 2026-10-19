import { Skeleton } from "@mantine/core";
import classes from "./LoadingSkeleton.module.css";

/** Calm placeholder for the center column while the first bootstrap is in flight. */
export function LoadingSkeleton() {
  return (
    <div className={classes.root} aria-busy="true" aria-label="Loading conversation">
      <div className={classes.thread}>
        <Skeleton height={14} width="38%" radius="sm" className={classes.right} />
        <Skeleton height={14} width="82%" radius="sm" />
        <Skeleton height={14} width="64%" radius="sm" />
        <Skeleton height={14} width="72%" radius="sm" />
      </div>
      <Skeleton height={88} radius="md" className={classes.composer} />
    </div>
  );
}
