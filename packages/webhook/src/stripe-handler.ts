import Stripe from 'stripe';
import { Request, Response } from 'express';
import { prisma } from './db.js';
import { getStripeConfig } from './config.js';

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
    console.error(`⚠️ Webhook signature verification failed.`, err.message);
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
          console.log(`Updated installation ${githubInstallationId} with Stripe details.`);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        
        await prisma.installation.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionStatus: subscription.status,
          },
        });
        console.log(`Updated subscription status for ${subscription.id} to ${subscription.status}.`);
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
}
