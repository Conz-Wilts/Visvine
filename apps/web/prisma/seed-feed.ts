/**
 * Seed script for 5 example feed posts in the Aus Startup Ecosystem community.
 * Run: npx tsx prisma/seed-feed.ts
 */

import prisma from '../lib/prisma';

async function main() {
  // Find the community - try matching "Aus" in the name
  const community = await prisma.community.findFirst({
    where: { name: { contains: 'Aus', mode: 'insensitive' } },
  });

  if (!community) {
    console.log('No community with "Aus" in the name found. Using first available community...');
  }

  const targetCommunity = community || (await prisma.community.findFirst());
  if (!targetCommunity) {
    console.error('No communities exist. Please create a community first.');
    process.exit(1);
  }

  console.log(`Seeding feed posts for community: ${targetCommunity.name} (${targetCommunity.id})`);

  // Get community members to use as authors
  const members = await prisma.userCommunity.findMany({
    where: { communityId: targetCommunity.id },
    include: { user: { include: { person: true } } },
    take: 5,
  });

  if (members.length === 0) {
    console.error('No members in this community. Please join the community first.');
    process.exit(1);
  }

  // Use available members, cycling through them
  const getAuthor = (i: number) => members[i % members.length].user;

  const posts = [
    {
      content: `Thrilled to announce that @${getAuthor(0).name} and the team just closed our Series A! 🎉

After 18 months of building in the Australian deep tech space, we've raised $12M to scale our AI-powered supply chain platform across APAC.

Huge thanks to our investors at [Blackbird Ventures](https://blackbird.vc) and [Square Peg Capital](https://squarepeg.com) for believing in the vision.

The Aussie startup ecosystem is absolutely firing right now. If you're building in logistics or supply chain tech, let's connect — we're hiring across engineering, product, and GTM.

#AusStartups #SeriesA #DeepTech #SupplyChain`,
      authorIndex: 0,
    },
    {
      content: `Just got back from [SydStart](https://sydstart.com) and honestly, the energy was incredible. 🇦🇺

Key takeaways from the conference:

1. Climate tech is the fastest growing sector in the Aus ecosystem — 3x YoY funding growth
2. The talent pipeline from UNSW and University of Melbourne is world-class
3. Government R&D tax incentives are making Australia genuinely competitive for deep tech

Met so many brilliant founders. Special shoutout to @${getAuthor(1).name} for the panel on building remote-first companies from Melbourne.

Who else was there? Drop a comment if you want to connect! 👇`,
      authorIndex: 1,
    },
    {
      content: `Hot take: The biggest untapped opportunity in the Australian startup ecosystem isn't fintech or SaaS — it's agriculture technology.

Australia has 55% of its landmass dedicated to agriculture. We export $65B+ in agricultural products annually. Yet agtech represents less than 2% of total VC funding here.

We just launched our precision farming platform with 15 pilot farms across Queensland and NSW. Early results showing 30% water savings and 22% yield improvement using satellite imagery + ML.

Looking for beta testers in the Riverina region. DM me if you know any forward-thinking farmers.

[Read our case study](https://example.com/agtech-case-study)

#AgTech #AustralianAgriculture #CleanTech #Sustainability`,
      authorIndex: 2,
    },
    {
      content: `We're hosting a free founder workshop at [Stone & Chalk](https://stoneandchalk.com.au) in Sydney next Thursday! 🚀

Topic: "From MVP to PMF — Lessons from 50 Australian Startups"

What we'll cover:
→ How @${getAuthor(3 % members.length).name} pivoted 3 times before finding product-market fit
→ The metrics that actually matter pre-Series A
→ Why most Aus startups over-index on the US market too early
→ Building a sustainable growth engine with limited capital

Limited to 40 spots. First come, first served.

Register here: [Workshop Registration](https://example.com/workshop)

See you there! 🙌`,
      authorIndex: 3 % members.length,
    },
    {
      content: `6 months ago I left my role as a senior engineer at Atlassian to go full-time on my startup. Here's an honest update:

The good:
✅ Revenue hit $15K MRR (up from $0)
✅ 3 enterprise customers signed in the last month
✅ Built an incredible team of 4 (all based in Melbourne)
✅ Part of the [Startmate](https://startmate.com) cohort which has been game-changing

The hard:
😅 Savings running lower than projected
😅 Enterprise sales cycles in Australia are LONG (avg 4.5 months)
😅 Finding senior full-stack devs in Melbourne is brutal right now
😅 The loneliness is real — thank god for founder communities like this one

Would I do it again? 100%. The Australian ecosystem is incredibly supportive. From Startmate mentors to the broader founder community, I've never felt alone in this journey.

If you're on the fence about making the leap — happy to chat. My DMs are always open.

#FounderLife #AusStartups #Startmate #Melbourne`,
      authorIndex: 4 % members.length,
    },
  ];

  for (let i = 0; i < posts.length; i++) {
    const { content, authorIndex } = posts[i];
    const author = getAuthor(authorIndex);

    // Stagger creation times so they appear in order
    const createdAt = new Date(Date.now() - (posts.length - i) * 3600 * 1000 * (i + 1));

    await prisma.post.create({
      data: {
        communityId: targetCommunity.id,
        authorId: author.id,
        content,
        createdAt,
      },
    });

    console.log(`  ✓ Created post ${i + 1}/5 by ${author.name}`);
  }

  console.log('\nDone! 5 feed posts created successfully.');
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
