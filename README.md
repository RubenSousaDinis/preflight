# Preflight

A fail-closed trust layer for two moments agents get wrong: hiring another agent, and sending a
transaction to a contract nobody has verified by hand. An ERC-8004 behavioral validator grades an
agent, two gates (`vetAgent`, `txGuard`) refuse by default, and a Preflight MCP server exposes both
checks to any client.

Built during ETHGlobal Lisbon 2026 (Classic track). This repo's first commit landed at the event
clock.

## Disclosed prior inputs

Stated here, before any feature code, per Classic-track eligibility:

1. [`@polygraphso/litmus`](https://www.npmjs.com/package/@polygraphso/litmus) from npm
   (Apache-2.0), the open behavioral grading engine, consumed as a library like any other
   third-party dependency would be. Its source is not read during this build, only its published
   package and public types.
2. A private planning repo (prose, a judge deck, an explainer) and Claude Design mockups, used to
   plan this build before the event. It carries no project code of its own.

polygraph's published grades and EAS attestations on Base are not an input: this project neither
writes to nor reads from them. Every grade shown here is produced at the event, by this project's
own validator, and read from the ERC-8004 Validation Registry.

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
