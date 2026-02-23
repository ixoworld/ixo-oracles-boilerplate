# Guide: Slack Integration — @ixo/slack

> **What you'll build:** A Slack bot that connects to your oracle, using Socket Mode for real-time messaging.

---

## Create a Slack App

<!-- TODO: Step-by-step Slack app creation, bot token + app token for Socket Mode -->

---

## Environment Variables

```env
SLACK_BOT_OAUTH_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_USE_SOCKET_MODE=true
SLACK_MAX_RECONNECT_ATTEMPTS=10
SLACK_RECONNECT_DELAY_MS=1000
```

---

## Same LangGraph Pipeline

<!-- TODO: Explain client='slack' triggers formatting constraints in the system prompt -->

The Slack bot uses the same LangGraph pipeline as portal and Matrix. When `client='slack'`, the system prompt adds Slack-specific formatting constraints.

---

## Formatting Differences

<!-- TODO: No markdown tables, Slack-compatible output, mrkdwn syntax -->

---

## Reconnection

<!-- TODO: SLACK_MAX_RECONNECT_ATTEMPTS, SLACK_RECONNECT_DELAY_MS -->

---

## Health Monitoring

<!-- TODO: slack.isConnected(), slackService.getStatus() -->

**Source:** `packages/slack/`
