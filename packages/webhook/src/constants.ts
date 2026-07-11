// Name of the GitHub check run Areté itself creates for every review it
// posts (see worker.ts). Shared so registerCheckRunWebhooks() can recognize
// and ignore check_run.completed events for Areté's OWN check run — GitHub
// delivers check_run events to the owning App for any check run under that
// App's installation, including ones the App created itself. Without this
// guard, Areté's own review check failing would re-trigger a fresh review:
// a self-triggering loop that burns LLM cost and posts duplicate reviews.
export const ARETE_CHECK_RUN_NAME = 'Areté AI Code Review'
