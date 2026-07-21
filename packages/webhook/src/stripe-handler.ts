import Stripe from 'stripe';
import { Request, Response } from 'express';
import { prisma } from './db.js';
import { getStripeConfig } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'stripe-handler' });

const stripeKey = getStripeConfig().secretKey
if (!stripeKey) throw new Error('STRIPE_SECRET_KEY env var is required')
const stripe = new Stripe(stripeKey, {
  apiVersion: '2026-06-24.dahlia',
});

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = getStripeConfig().webhookSecret;

  if (!sig || !webhookSecret) {
    res.status(400).send('Missing signature or secret');
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    log.error({ err: err.message }, 'Webhook signature verification failed');
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const githubInstallationId = session.client_reference_id ? parseInt(session.client_reference_id) : null;

        if (githubInstallationId && session.customer && session.subscription) {
          // Checkout sessions carry a GitHub App installation id — scope the
          // update by provider so it can never hit a GitLab row whose
          // externalId happens to share the same number.
          await prisma.installation.updateMany({
            where: { provider: 'github', externalId: githubInstallationId },
            data: {
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: session.subscription as string,
              subscriptionStatus: 'active',
            },
          });
          log.info({ installationId: githubInstallationId }, 'Updated installation with Stripe details');
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        // Resolve the purchased tier from the subscription's price so billing.ts
        // can enforce the tier's monthly review limit. The subscription object
        // on these events carries its line items inline (no extra API call).
        // If the price isn't a configured tier (or no price env is set), leave
        // planTier untouched rather than overwriting it with a wrong value.
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const tier = priceId ? getStripeConfig().priceToTier[priceId] : undefined;

        const data: { subscriptionStatus: string; planTier?: string } = {
          subscriptionStatus: subscription.status,
        };
        if (tier) data.planTier = tier;

        await prisma.installation.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data,
        });
        log.info(
          { subscriptionId: subscription.id, status: subscription.status, tier },
          'Updated subscription'
        );
        break;
      }
      default:
        log.info({ eventType: event.type }, 'Unhandled event type');
    }
    res.json({ received: true });
  } catch (error) {
    log.error({ err: error }, 'Error processing webhook');
    res.status(500).send('Internal Server Error');
  }
}
