/**
 * Database Record Completion Script
 * Fills in missing fields for all person/node records with realistic data.
 *
 * Usage:
 *   node apps/web/prisma/seeds/complete-records.mjs --dry-run   # Preview changes
 *   node apps/web/prisma/seeds/complete-records.mjs              # Execute changes
 */

import pg from 'pg';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`ERROR: ${name} is not set in apps/web/.env`);
    process.exit(1);
  }
  return v;
}

const pool = new pg.Pool({
  host: requireEnv('DB_HOST'),
  port: parseInt(requireEnv('DB_PORT')),
  database: requireEnv('DB_NAME'),
  user: requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
});

const uuid = () => crypto.randomUUID();

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION DATA — Well-known people (SF Ecosystem)
// ═══════════════════════════════════════════════════════════════════════════════

const sfPersonCompletions = {
  'person:sam-altman': {
    bio: 'CEO of OpenAI, former president of Y Combinator. Leading the development of safe and beneficial artificial general intelligence. Previously co-founded Loopt and served as a partner at Y Combinator before becoming president in 2014.',
    website: 'https://blog.samaltman.com',
    linkedinUrl: 'https://linkedin.com/in/samaltman',
    twitterUrl: 'https://twitter.com/sama',
    phone: '+1 415 555 0101',
    pronouns: 'he/him',
  },
  'person:jensen-huang': {
    bio: 'Co-founder and CEO of NVIDIA since 1993. Transformed NVIDIA from a graphics chip company into the world\'s most valuable semiconductor company, powering the AI revolution. Born in Taiwan, raised in the US.',
    website: 'https://nvidia.com',
    linkedinUrl: 'https://linkedin.com/in/jenshuang',
    twitterUrl: 'https://twitter.com/nvidia',
    phone: '+1 408 555 0102',
    pronouns: 'he/him',
  },
  'person:dara-khosrowshahi': {
    bio: 'CEO of Uber since 2017. Previously served as CEO of Expedia Group for 12 years. Born in Tehran, Iran, and emigrated to the US as a child. Known for stabilizing Uber\'s culture and leading it to profitability.',
    website: 'https://uber.com',
    linkedinUrl: 'https://linkedin.com/in/darakhosrowshahi',
    twitterUrl: 'https://twitter.com/daborak',
    phone: '+1 415 555 0103',
    pronouns: 'he/him',
  },
  'person:patrick-collison': {
    bio: 'Co-founder and CEO of Stripe. Born in Ireland, started his first company at 16. With his brother John, built Stripe into the world\'s most valuable private fintech company. Passionate about economic infrastructure, science funding, and fast-growing cities.',
    website: 'https://patrickcollison.com',
    linkedinUrl: 'https://linkedin.com/in/patrickcollison',
    twitterUrl: 'https://twitter.com/patrickc',
    phone: '+1 415 555 0104',
    pronouns: 'he/him',
  },
  'person:john-collison': {
    bio: 'Co-founder and President of Stripe. Originally from Limerick, Ireland. Became the world\'s youngest self-made billionaire at 26. Oversees Stripe\'s engineering, revenue, and business operations. Active angel investor in developer tools.',
    website: 'https://stripe.com',
    linkedinUrl: 'https://linkedin.com/in/johncollison',
    twitterUrl: 'https://twitter.com/collision',
    phone: '+1 415 555 0105',
    pronouns: 'he/him',
  },
  'person:tobi-lutke': {
    bio: 'Founder and CEO of Shopify. Originally from Koblenz, Germany. Built Shopify from a snowboard equipment store into the leading commerce platform powering millions of businesses worldwide. Strong advocate for remote work and developer empowerment.',
    website: 'https://shopify.com',
    linkedinUrl: 'https://linkedin.com/in/tobiaslutke',
    twitterUrl: 'https://twitter.com/toaborak',
    phone: '+1 613 555 0106',
    pronouns: 'he/him',
  },
  'person:naval-ravikant': {
    bio: 'Co-founder of AngelList and Epirus. Prolific angel investor with early stakes in Twitter, Uber, and 200+ companies. Author of "The Almanack of Naval Ravikant." Known for his philosophical takes on wealth creation, happiness, and technology.',
    website: 'https://nav.al',
    linkedinUrl: 'https://linkedin.com/in/navalravikant',
    twitterUrl: 'https://twitter.com/naval',
    phone: '+1 415 555 0107',
    pronouns: 'he/him',
  },
  'person:reid-hoffman': {
    bio: 'Co-founder of LinkedIn and partner at Greylock. Board member at Microsoft and various AI companies. Author of "Blitzscaling" and "The Start-up of You." One of the original PayPal Mafia members. Deep thinker on network effects and scaling.',
    website: 'https://reidhoffman.com',
    linkedinUrl: 'https://linkedin.com/in/reidhoffman',
    twitterUrl: 'https://twitter.com/reidhoffman',
    phone: '+1 650 555 0108',
    pronouns: 'he/him',
  },
  'person:marc-andreessen': {
    bio: 'Co-founder and General Partner of Andreessen Horowitz (a16z). Co-creator of Mosaic, the first widely used web browser, and co-founder of Netscape. Author of the influential essay "Why Software Is Eating The World." One of the most influential VCs in Silicon Valley.',
    website: 'https://pmarca.substack.com',
    linkedinUrl: 'https://linkedin.com/in/mandreessen',
    twitterUrl: 'https://twitter.com/pmarca',
    phone: '+1 650 555 0109',
    pronouns: 'he/him',
  },
  'person:peter-thiel': {
    bio: 'Co-founder of PayPal, Palantir Technologies, and Founders Fund. First outside investor in Facebook. Author of "Zero to One." Contrarian thinker known for his thesis that competition is for losers and monopolies drive innovation.',
    website: 'https://foundersfund.com',
    linkedinUrl: 'https://linkedin.com/in/peterthiel',
    twitterUrl: null,
    phone: '+1 415 555 0110',
    pronouns: 'he/him',
  },
  'person:elad-gil': {
    bio: 'Entrepreneur, investor, and author of "High Growth Handbook." Former VP at Twitter and co-founder of Color Genomics. Prolific angel investor in AI, biotech, and crypto. Advisor to companies including Airbnb, Coinbase, and Stripe.',
    website: 'https://blog.eladgil.com',
    linkedinUrl: 'https://linkedin.com/in/eladgil',
    twitterUrl: 'https://twitter.com/eladgil',
    phone: '+1 415 555 0111',
    pronouns: 'he/him',
  },
  'person:garry-tan': {
    bio: 'President and CEO of Y Combinator since 2023. Previously co-founded Initialized Capital, investing early in Coinbase, Instacart, and Flexport. YC partner from 2011-2015. Designer and engineer by training with a passion for builder culture.',
    website: 'https://garrytan.com',
    linkedinUrl: 'https://linkedin.com/in/garrytan',
    twitterUrl: 'https://twitter.com/garrytan',
    phone: '+1 415 555 0112',
    pronouns: 'he/him',
  },
  'person:sarah-guo': {
    bio: 'Founder and Managing Partner of Conviction, an AI-focused venture firm. Previously General Partner at Greylock for 7 years. Early investor in Coda, Figma, and numerous AI companies. Co-host of the "No Priors" AI podcast.',
    website: 'https://conviction.com',
    linkedinUrl: 'https://linkedin.com/in/sarahguo',
    twitterUrl: 'https://twitter.com/saranormous',
    phone: '+1 415 555 0113',
    pronouns: 'she/her',
  },
  'person:vinod-khosla': {
    bio: 'Founder of Khosla Ventures and co-founder of Sun Microsystems. One of the most successful venture capitalists in history, investing in clean energy, AI, and frontier technologies. Former general partner at Kleiner Perkins.',
    website: 'https://khoslaventures.com',
    linkedinUrl: 'https://linkedin.com/in/vinodkhosla',
    twitterUrl: 'https://twitter.com/vaborakhosla',
    phone: '+1 650 555 0114',
    pronouns: 'he/him',
  },
  'person:ann-miura-ko': {
    bio: 'Co-founder and General Partner of Floodgate, one of the top seed-stage venture firms. Named "The Most Powerful Woman in Startups" by Forbes. PhD from Stanford in mathematical modeling. Early investor in Lyft, Refinery29, and TaskRabbit.',
    website: 'https://floodgate.com',
    linkedinUrl: 'https://linkedin.com/in/annmiurako',
    twitterUrl: 'https://twitter.com/annimaniac',
    phone: '+1 650 555 0115',
    pronouns: 'she/her',
  },
};

// SF Founders without Person records
const sfFounderPersons = {
  'founder:aaron-levie': {
    name: 'Aaron Levie', subtitle: 'Co-Founder & CEO, Box',
    bio: 'Co-founder and CEO of Box, the enterprise content management platform. Started Box in his dorm room at USC in 2005. Known for his energetic Twitter presence and advocacy for cloud computing and enterprise software.',
    location: 'San Francisco, CA', website: 'https://box.com',
    linkedinUrl: 'https://linkedin.com/in/aaronlevie', twitterUrl: 'https://twitter.com/levie',
    phone: '+1 650 555 0201', pronouns: 'he/him', tags: ['Cloud', 'Enterprise', 'SaaS'],
  },
  'founder:alexis-ohanian': {
    name: 'Alexis Ohanian', subtitle: 'Co-founder, Reddit & Seven Seven Six',
    bio: 'Co-founder of Reddit, Initialized Capital, and Seven Seven Six. Author of "Without Their Permission." Married to Serena Williams. Active investor and advocate for the open internet and creator economy.',
    location: 'San Francisco, CA', website: 'https://alexisohanian.com',
    linkedinUrl: 'https://linkedin.com/in/alexisohanian', twitterUrl: 'https://twitter.com/alexisohanian',
    phone: '+1 415 555 0202', pronouns: 'he/him', tags: ['Reddit', 'VC', 'Creator Economy'],
  },
  'founder:brian-chesky': {
    name: 'Brian Chesky', subtitle: 'CEO & Co-founder, Airbnb',
    bio: 'Co-founder and CEO of Airbnb. Trained as an industrial designer at RISD. Transformed the travel industry by pioneering the home-sharing economy. Named to Time 100 multiple times. Known for his design-driven leadership style.',
    location: 'San Francisco, CA', website: 'https://airbnb.com',
    linkedinUrl: 'https://linkedin.com/in/brianchesky', twitterUrl: 'https://twitter.com/bchesky',
    phone: '+1 415 555 0203', pronouns: 'he/him', tags: ['Travel', 'Marketplace', 'Design'],
  },
  'founder:brian-armstrong': {
    name: 'Brian Armstrong', subtitle: 'CEO & Co-founder, Coinbase',
    bio: 'Co-founder and CEO of Coinbase, the largest cryptocurrency exchange in the US. Previously a software engineer at Airbnb. Advocate for cryptocurrency adoption and financial freedom through decentralized finance.',
    location: 'San Francisco, CA', website: 'https://coinbase.com',
    linkedinUrl: 'https://linkedin.com/in/barmstrong', twitterUrl: 'https://twitter.com/brian_armstrong',
    phone: '+1 415 555 0204', pronouns: 'he/him', tags: ['Crypto', 'Fintech', 'Web3'],
  },
  'founder:ben-silbermann': {
    name: 'Ben Silbermann', subtitle: 'Co-founder, Pinterest',
    bio: 'Co-founder of Pinterest, the visual discovery platform. Previously worked at Google in ad products. Stepped back from CEO role in 2022 to become Executive Chairman. Passionate about collecting, visual inspiration, and building products people love.',
    location: 'San Francisco, CA', website: 'https://pinterest.com',
    linkedinUrl: 'https://linkedin.com/in/bensilbermann', twitterUrl: 'https://twitter.com/8ensilbermann',
    phone: '+1 415 555 0205', pronouns: 'he/him', tags: ['Social Media', 'Visual', 'Consumer'],
  },
  'founder:biz-stone': {
    name: 'Biz Stone', subtitle: 'Co-founder, Twitter & Jelly',
    bio: 'Co-founder of Twitter, Medium, and Jelly. Author of "Things a Little Bird Told Me." Creative visionary who helped build one of the most influential social media platforms in history. Advocate for using technology to improve society.',
    location: 'San Francisco, CA', website: 'https://medium.com/@biz',
    linkedinUrl: 'https://linkedin.com/in/bizstone', twitterUrl: 'https://twitter.com/biz',
    phone: '+1 415 555 0206', pronouns: 'he/him', tags: ['Social Media', 'Twitter', 'Media'],
  },
  'founder:bastian-lehmann': {
    name: 'Bastian Lehmann', subtitle: 'Former CEO & Co-Founder, Postmates',
    bio: 'Co-founded Postmates in 2011, pioneering on-demand delivery in San Francisco before it was acquired by Uber for $2.65 billion in 2020. German-born entrepreneur who moved to SF to build in the logistics space.',
    location: 'San Francisco, CA', website: 'https://linkedin.com/in/bastianlehmann',
    linkedinUrl: 'https://linkedin.com/in/bastianlehmann', twitterUrl: 'https://twitter.com/bastianlehmaborak',
    phone: '+1 415 555 0207', pronouns: 'he/him', tags: ['Logistics', 'On-demand', 'Marketplace'],
  },
};

// SF additional person completions (already have Person records)
const sfAdditionalCompletions = {
  'person:aaron-patzer': {
    bio: 'Founder of Mint.com, the personal finance tool acquired by Intuit for $170M. Angel investor and serial entrepreneur focused on fintech and consumer products.',
    location: 'San Francisco, CA', website: 'https://linkedin.com/in/aaronpatzer',
    linkedinUrl: 'https://linkedin.com/in/aaronpatzer', twitterUrl: 'https://twitter.com/aaronpatzer',
    phone: '+1 415 555 0301', pronouns: 'he/him', tags: ['Fintech', 'Consumer', 'Angel'],
  },
  'person:alexandr-wang': {
    bio: 'CEO and co-founder of Scale AI, building the data infrastructure for AI. Became the youngest self-made billionaire at age 25. Dropped out of MIT to start Scale AI. Advises the US government on AI policy.',
    location: 'San Francisco, CA', website: 'https://scale.com',
    linkedinUrl: 'https://linkedin.com/in/alexandrwang', twitterUrl: 'https://twitter.com/alexandr_wang',
    phone: '+1 415 555 0302', pronouns: 'he/him', tags: ['AI', 'Data', 'Defense'],
  },
  'person:apoorva-mehta': {
    bio: 'Founder and former CEO of Instacart. Born in India, grew up in Canada, and moved to SF to build. Instacart pioneered grocery delivery and grew to a $39B valuation before its 2023 IPO.',
    location: 'San Francisco, CA', website: 'https://instacart.com',
    linkedinUrl: 'https://linkedin.com/in/apoorvamehta', twitterUrl: 'https://twitter.com/apaboraka',
    phone: '+1 415 555 0303', pronouns: 'he/him', tags: ['Grocery', 'On-demand', 'Marketplace'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION DATA — NZ Ecosystem (startup-nz)
// ═══════════════════════════════════════════════════════════════════════════════

const nzPersonCompletions = {
  'person:rod-drury': {
    bio: 'Founder of Xero, the cloud accounting platform that transformed small business finance. New Zealand\'s most successful tech entrepreneur. Previously founded AfterMail and Glazier Systems. Appointed ONZM for services to business.',
    website: 'https://xero.com', linkedinUrl: 'https://linkedin.com/in/roddrury',
    twitterUrl: 'https://twitter.com/roddrury', phone: '+64 21 555 0001', pronouns: 'he/him',
  },
  'person:peter-beck': {
    bio: 'Founder and CEO of Rocket Lab, the first private company to reach orbit from the Southern Hemisphere. Built rockets as a teenager in Invercargill. Took Rocket Lab public on NASDAQ. Pushing boundaries in small satellite launch and space systems.',
    website: 'https://rocketlabusa.com', linkedinUrl: 'https://linkedin.com/in/peter-beck-4b9b6a1',
    twitterUrl: 'https://twitter.com/Peter_J_Beck', phone: '+64 21 555 0002', pronouns: 'he/him',
  },
  'person:vaughan-rowsell': {
    bio: 'Founder of Vend, the cloud-based POS system for retailers, acquired by Lightspeed in 2021. One of New Zealand\'s most respected SaaS founders. Angel investor and mentor to NZ startups.',
    website: 'https://linkedin.com/in/vaughanrowsell', linkedinUrl: 'https://linkedin.com/in/vaughanrowsell',
    twitterUrl: 'https://twitter.com/vaughanrowsell', phone: '+64 21 555 0003', pronouns: 'he/him',
  },
  'person:eliot-crowther': {
    bio: 'Co-founder of Vend alongside Vaughan Rowsell. Engineering leader who built Vend\'s core POS platform. Active in Auckland\'s startup community and mentors early-stage technical founders.',
    website: 'https://linkedin.com/in/eliotcrowther', linkedinUrl: 'https://linkedin.com/in/eliotcrowther',
    twitterUrl: null, phone: '+64 21 555 0004', pronouns: 'he/him',
  },
  'person:craig-winkler': {
    bio: 'Co-founder of Pushpay, the mobile payments platform for churches and nonprofits that was acquired by Pegasus for NZ$1.3B. Early pioneer in mobile giving technology. Investor in the NZ tech ecosystem.',
    website: 'https://linkedin.com/in/craigwinkler', linkedinUrl: 'https://linkedin.com/in/craigwinkler',
    twitterUrl: null, phone: '+64 21 555 0005', pronouns: 'he/him',
  },
  'person:jamie-beaton': {
    bio: 'Founder and CEO of Crimson Education, helping students globally gain admission to top universities. Founded Crimson at age 19. Holds degrees from Harvard, Stanford, and Oxford. New Zealand\'s youngest self-made entrepreneur in edtech.',
    website: 'https://crimsoneducation.org', linkedinUrl: 'https://linkedin.com/in/jamiebeaton',
    twitterUrl: 'https://twitter.com/jamiebeaton', phone: '+64 21 555 0006', pronouns: 'he/him',
  },
  'person:craig-piggott': {
    bio: 'Founder and CEO of Halter, building smart collars for dairy cows that enable virtual fencing and remote herd management. Backed by Blackbird and raised over NZ$100M. Transforming agriculture with deep tech from Auckland.',
    website: 'https://halterhq.com', linkedinUrl: 'https://linkedin.com/in/craigpiggott',
    twitterUrl: 'https://twitter.com/craigpiggott', phone: '+64 21 555 0007', pronouns: 'he/him',
  },
  'person:phil-thomson': {
    bio: 'Co-founder of Auror, the retail crime intelligence platform used by major retailers worldwide. Previously in NZ Police. Built Auror to connect retailers and law enforcement through data-driven crime prevention.',
    website: 'https://auror.co', linkedinUrl: 'https://linkedin.com/in/philthomson',
    twitterUrl: null, phone: '+64 21 555 0008', pronouns: 'he/him',
  },
  'person:william-kerr': {
    bio: 'CEO of Mint Innovation, developing biotechnology to recover precious metals from e-waste using microbes. University of Canterbury spin-out tackling the circular economy. Winner of multiple cleantech awards.',
    website: 'https://mintinnovation.co.nz', linkedinUrl: 'https://linkedin.com/in/williamkerr',
    twitterUrl: null, phone: '+64 21 555 0009', pronouns: 'he/him',
  },
  'person:ryan-baker': {
    bio: 'Founder of Timely, the appointment scheduling platform for salons and spas, acquired by EverCommerce. Built a globally successful SaaS business from Auckland. Active startup mentor.',
    website: 'https://linkedin.com/in/ryanbakernz', linkedinUrl: 'https://linkedin.com/in/ryanbakernz',
    twitterUrl: null, phone: '+64 21 555 0010', pronouns: 'he/him',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION DATA — AU Ecosystem (missing Person records)
// ═══════════════════════════════════════════════════════════════════════════════

const auMissingPersons = {
  'person:alan-noble': {
    name: 'Alan Noble', subtitle: 'Former Engineering Director, Google AU',
    bio: 'Former Engineering Director at Google Australia, where he led the Sydney engineering office for over a decade. Now focused on tech education and supporting the Australian startup ecosystem through mentorship and board roles.',
    location: 'Sydney, NSW', website: 'https://linkedin.com/in/alannoble',
    linkedinUrl: 'https://linkedin.com/in/alannoble', twitterUrl: null,
    phone: '+61 400 000 101', pronouns: 'he/him', tags: ['Engineering', 'Big Tech', 'Education'],
  },
  'person:alex-scandurra': {
    name: 'Alex Scandurra', subtitle: 'CEO, Stone & Chalk',
    bio: 'CEO of Stone & Chalk, Australia\'s largest innovation hub connecting fintech startups with corporates and government. Previously led innovation at Westpac. Champion of the Australian fintech ecosystem.',
    location: 'Sydney, NSW', website: 'https://stoneandchalk.com.au',
    linkedinUrl: 'https://linkedin.com/in/alexscandurra', twitterUrl: 'https://twitter.com/alexscandurra',
    phone: '+61 400 000 102', pronouns: 'he/him', tags: ['Fintech', 'Innovation Hub', 'Community'],
  },
  'person:anthony-eisen': {
    name: 'Anthony Eisen', subtitle: 'Co-founder, Afterpay',
    bio: 'Co-founded Afterpay with Nick Molnar in 2014, pioneering buy-now-pay-later globally. Former investment banker at Guinness Peat Group. Led Afterpay through its $39B acquisition by Block (formerly Square) in 2022.',
    location: 'Melbourne, VIC', website: 'https://linkedin.com/in/anthonyeisen',
    linkedinUrl: 'https://linkedin.com/in/anthonyeisen', twitterUrl: null,
    phone: '+61 400 000 103', pronouns: 'he/him', tags: ['Fintech', 'BNPL', 'Investing'],
  },
  'person:bill-bartee': {
    name: 'Bill Bartee', subtitle: 'Managing Director, Main Sequence',
    bio: 'Managing Director of Main Sequence, the CSIRO-backed deep tech venture fund. Bridges world-class Australian research with commercial opportunities. Previously led Cisco Investments in Asia-Pacific.',
    location: 'Sydney, NSW', website: 'https://mseq.vc',
    linkedinUrl: 'https://linkedin.com/in/billbartee', twitterUrl: 'https://twitter.com/billbartee',
    phone: '+61 400 000 104', pronouns: 'he/him', tags: ['Deep Tech', 'CSIRO', 'Science', 'VC'],
  },
  'person:cameron-adams': {
    name: 'Cameron Adams', subtitle: 'CPO & Co-founder, Canva',
    bio: 'Co-founder and Chief Product Officer at Canva. Previously a web designer known as "The Man in Blue." Built early consumer web products at Google. Joined Mel and Cliff to co-found Canva in 2012, leading product vision.',
    location: 'Sydney, NSW', website: 'https://themaninblue.com',
    linkedinUrl: 'https://linkedin.com/in/camerronadams', twitterUrl: 'https://twitter.com/themaninblue',
    phone: '+61 400 000 105', pronouns: 'he/him', tags: ['Design', 'Product', 'UX'],
  },
  'person:chris-gilmour': {
    name: 'Chris Gilmour', subtitle: 'Co-founder, Eucalyptus',
    bio: 'Co-founded Eucalyptus, Australia\'s leading digital health company operating brands like Pilot and Kin Fertility. Former consultant at Bain & Company. Building the future of telehealth and direct-to-consumer healthcare.',
    location: 'Sydney, NSW', website: 'https://eucalyptus.vc',
    linkedinUrl: 'https://linkedin.com/in/chrisgilmour', twitterUrl: null,
    phone: '+61 400 000 106', pronouns: 'he/him', tags: ['Health Tech', 'Telehealth', 'DTC'],
  },
  'person:cliff-obrecht': {
    name: 'Cliff Obrecht', subtitle: 'COO & Co-founder, Canva',
    bio: 'Co-founder and COO of Canva. Oversees business operations, legal, people, and finance. Previously co-founded Fusion Books with Melanie Perkins. Together they grew Canva from a Perth startup to a $40B global platform.',
    location: 'Sydney, NSW', website: 'https://canva.com',
    linkedinUrl: 'https://linkedin.com/in/cliffobrecht', twitterUrl: null,
    phone: '+61 400 000 107', pronouns: 'he/him', tags: ['Design', 'Operations', 'SaaS'],
  },
  'person:craig-blair': {
    name: 'Craig Blair', subtitle: 'Co-founder, AirTree Ventures',
    bio: 'Co-founded AirTree Ventures, one of Australia\'s leading venture capital firms. Previously an executive at Macquarie Group. Focused on marketplace, SaaS, and fintech investments across Australia and New Zealand.',
    location: 'Sydney, NSW', website: 'https://airtree.vc',
    linkedinUrl: 'https://linkedin.com/in/craigblair', twitterUrl: 'https://twitter.com/craigblair',
    phone: '+61 400 000 108', pronouns: 'he/him', tags: ['VC', 'Growth', 'Marketplace'],
  },
  'person:daniel-petre': {
    name: 'Daniel Petre', subtitle: 'Co-founder, AirTree Ventures',
    bio: 'Co-founder of AirTree Ventures and one of Australia\'s most experienced tech executives. Former VP at Microsoft responsible for the Asia-Pacific region. Author and thought leader on technology\'s impact on society.',
    location: 'Sydney, NSW', website: 'https://airtree.vc',
    linkedinUrl: 'https://linkedin.com/in/danielpetre', twitterUrl: null,
    phone: '+61 400 000 109', pronouns: 'he/him', tags: ['VC', 'Growth', 'SaaS'],
  },
  'person:fred-schebesta': {
    name: 'Fred Schebesta', subtitle: 'Co-founder, Finder',
    bio: 'Co-founded Finder, Australia\'s largest comparison platform helping millions of consumers make better financial decisions. Serial entrepreneur who started his first business at 19. Active investor and crypto enthusiast.',
    location: 'Sydney, NSW', website: 'https://finder.com.au',
    linkedinUrl: 'https://linkedin.com/in/fredschebesta', twitterUrl: 'https://twitter.com/fredschebesta',
    phone: '+61 400 000 110', pronouns: 'he/him', tags: ['Fintech', 'Comparison', 'Media', 'Crypto'],
  },
  'person:jemma-green': {
    name: 'Jemma Green', subtitle: 'Co-founder, Power Ledger',
    bio: 'Co-founded Power Ledger, a blockchain-based platform for peer-to-peer energy trading. Former investment banker at JP Morgan in London. Holds a PhD from Curtin University in sustainability. Driving the clean energy transition through technology.',
    location: 'Perth, WA', website: 'https://powerledger.io',
    linkedinUrl: 'https://linkedin.com/in/jemmagreen', twitterUrl: 'https://twitter.com/jaboragreenpl',
    phone: '+61 400 000 111', pronouns: 'she/her', tags: ['Energy', 'Blockchain', 'Climate', 'Sustainability'],
  },
  'person:jordan-grives': {
    name: 'Jordan Grives', subtitle: 'Community Lead, Fishburners',
    bio: 'Community Lead at Fishburners, Australia\'s largest startup community space in Sydney. Passionate about connecting founders, hosting events, and fostering the grassroots startup ecosystem. Previously in community management at WeWork.',
    location: 'Sydney, NSW', website: 'https://fishburners.org',
    linkedinUrl: 'https://linkedin.com/in/jordangrives', twitterUrl: 'https://twitter.com/jordangrives',
    phone: '+61 400 000 112', pronouns: 'he/him', tags: ['Community', 'Coworking', 'Startups'],
  },
  'person:kate-cornick': {
    name: 'Kate Cornick', subtitle: 'CEO, LaunchVic',
    bio: 'CEO of LaunchVic, the Victorian Government\'s startup development agency. Oversees grants, programs, and policy to grow Victoria\'s startup ecosystem. Previously led digital strategy at Deloitte. Strong advocate for diversity in tech.',
    location: 'Melbourne, VIC', website: 'https://launchvic.org',
    linkedinUrl: 'https://linkedin.com/in/katecornick', twitterUrl: 'https://twitter.com/katecornick',
    phone: '+61 400 000 113', pronouns: 'she/her', tags: ['Government', 'Startup Policy', 'Ecosystem'],
  },
  'person:mark-pesce': {
    name: 'Mark Pesce', subtitle: 'Futurist & Author',
    bio: 'Futurist, author, inventor, and educator. Co-invented VRML, the first standard for 3D on the web. Regular panellist on ABC\'s "The New Inventors" and "Good Game." Honorary Associate at the University of Sydney. Author of seven books on technology and society.',
    location: 'Sydney, NSW', website: 'https://markpesce.com',
    linkedinUrl: 'https://linkedin.com/in/markpesce', twitterUrl: 'https://twitter.com/mpesce',
    phone: '+61 400 000 114', pronouns: 'he/him', tags: ['Futurism', 'VR', 'Media', 'Education'],
  },
  'person:matt-barrie': {
    name: 'Matt Barrie', subtitle: 'CEO, Freelancer',
    bio: 'CEO and founder of Freelancer.com, one of the world\'s largest freelancing marketplaces with 70M+ users. Previously founded Sensory Networks (acquired by Intel). Adjunct Professor at the University of Sydney. EY Entrepreneur of the Year winner.',
    location: 'Sydney, NSW', website: 'https://freelancer.com',
    linkedinUrl: 'https://linkedin.com/in/mattbarrie', twitterUrl: 'https://twitter.com/mattbarrie',
    phone: '+61 400 000 115', pronouns: 'he/him', tags: ['Marketplace', 'Gig Economy', 'Tech'],
  },
  'person:nick-molnar': {
    name: 'Nick Molnar', subtitle: 'Co-founder, Afterpay',
    bio: 'Co-founded Afterpay at age 24, revolutionizing consumer payments with buy-now-pay-later. Previously worked in his family\'s jewelry business and cut his teeth selling on eBay. Led Afterpay through its US$29B acquisition by Block in 2022.',
    location: 'Melbourne, VIC', website: 'https://linkedin.com/in/nickmolnar',
    linkedinUrl: 'https://linkedin.com/in/nickmolnar', twitterUrl: 'https://twitter.com/nickmolnar',
    phone: '+61 400 000 116', pronouns: 'he/him', tags: ['Fintech', 'BNPL', 'Retail'],
  },
  'person:paul-bassat': {
    name: 'Paul Bassat', subtitle: 'Co-founder, Square Peg Capital',
    bio: 'Co-founded Square Peg Capital, a global VC firm investing from Australia into companies like Canva, Airwallex, and Fiverr. Previously co-founded SEEK, Australia\'s largest online employment marketplace. AFL Commissioner.',
    location: 'Melbourne, VIC', website: 'https://squarepegcap.com',
    linkedinUrl: 'https://linkedin.com/in/paulbassat', twitterUrl: null,
    phone: '+61 400 000 117', pronouns: 'he/him', tags: ['VC', 'Global', 'Fintech'],
  },
  'person:sally-ann-williams': {
    name: 'Sally-Ann Williams', subtitle: 'CEO, Cicada Innovations',
    bio: 'CEO of Cicada Innovations, Australia\'s leading deep tech incubator based in Eveleigh, Sydney. Supports startups commercialising research in medtech, cleantech, and advanced manufacturing. Previously an engineer at Google and Cochlear.',
    location: 'Sydney, NSW', website: 'https://cicadainnovations.com',
    linkedinUrl: 'https://linkedin.com/in/sallyannwilliams', twitterUrl: 'https://twitter.com/sallyannwill',
    phone: '+61 400 000 118', pronouns: 'she/her', tags: ['Deep Tech', 'Incubator', 'Science', 'MedTech'],
  },
  'person:tim-fung': {
    name: 'Tim Fung', subtitle: 'CEO & Co-founder, Airtasker',
    bio: 'Co-founded Airtasker, the local services marketplace connecting people with skilled taskers. Listed Airtasker on the ASX in 2021. Former Fishburners alumnus. Passionate about building community-driven marketplaces.',
    location: 'Sydney, NSW', website: 'https://airtasker.com',
    linkedinUrl: 'https://linkedin.com/in/timfung', twitterUrl: 'https://twitter.com/timfung',
    phone: '+61 400 000 119', pronouns: 'he/him', tags: ['Marketplace', 'Gig Economy', 'Services', 'ASX'],
  },
  'person:niki-scevak': {
    name: 'Niki Scevak', subtitle: 'Co-founder, Blackbird Ventures',
    bio: 'Co-founded Blackbird Ventures, Australia\'s largest venture capital fund with over $2B under management. Previously founded Startmate, the leading ANZ startup accelerator. Passionate about backing ambitious founders across Australia and NZ.',
    location: 'Sydney, NSW', website: 'https://blackbird.vc',
    linkedinUrl: 'https://linkedin.com/in/nikiscevak', twitterUrl: 'https://twitter.com/nikiscevak',
    phone: '+61 400 000 120', pronouns: 'he/him', tags: ['VC', 'Startups', 'Ambition'],
  },
  'person:rick-baker': {
    name: 'Rick Baker', subtitle: 'Partner, Blackbird Ventures',
    bio: 'Partner at Blackbird Ventures, focusing on early-stage investments. Previously co-founded Startmate. Experienced operator who has helped scale multiple Australian startups. Active mentor and ecosystem builder.',
    location: 'Sydney, NSW', website: 'https://blackbird.vc',
    linkedinUrl: 'https://linkedin.com/in/rickbaker', twitterUrl: 'https://twitter.com/rickbaker',
    phone: '+61 400 000 121', pronouns: 'he/him', tags: ['VC', 'Seed', 'Series A'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION DATA — Icehouse Ventures team
// ═══════════════════════════════════════════════════════════════════════════════

const icehouseCompletions = {
  'person:robbie-paul': {
    bio: 'CEO of Icehouse Ventures, New Zealand\'s most active venture capital firm. Leads the team investing in NZ\'s most ambitious startups across seed and growth stages.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/robbiepaul', tags: ['VC', 'CEO', 'Startups'],
  },
  'person:matt-gunn': {
    bio: 'COO at Icehouse Ventures, overseeing operations, fund management, and investor relations. Ensures the firm runs smoothly as it scales its portfolio and fund size.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/mattgunn', tags: ['Operations', 'VC', 'Fund Management'],
  },
  'person:scott-turner': {
    bio: 'CFO at Icehouse Ventures, managing financial operations, reporting, and compliance across multiple venture funds. Experienced finance leader in the NZ investment industry.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/scottturner', tags: ['Finance', 'VC', 'CFO'],
  },
  'person:peter-thomson': {
    bio: 'CTO at Icehouse Ventures, building the technology platform that supports portfolio management, deal flow, and investor communications.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/peterthomson', tags: ['Technology', 'CTO', 'Engineering'],
  },
  'person:jack-mcquire': {
    bio: 'Partner at Icehouse Ventures, leading investments in high-growth NZ startups. Focused on SaaS, marketplace, and deep tech opportunities.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/jackmcquire', tags: ['VC', 'Investing', 'Partner'],
  },
  'person:jo-wickham': {
    bio: 'Partner at Icehouse Ventures, investing in ambitious NZ founders across consumer and enterprise sectors. Experienced operator turned investor.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/jowickham', tags: ['VC', 'Investing', 'Partner'],
  },
  'person:jason-wang': {
    bio: 'Partner at Icehouse Ventures, sourcing and leading investments. Background in technology and entrepreneurship with deep networks across the APAC startup ecosystem.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/jasonwang', tags: ['VC', 'Investing', 'APAC'],
  },
  'person:barnaby-marshall': {
    bio: 'Partner at Icehouse Ventures, supporting portfolio companies through growth stages. Strong background in strategy consulting and venture capital.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/barnabymarshall', tags: ['VC', 'Investing', 'Strategy'],
  },
  'person:bex-gidall': {
    bio: 'Principal at Icehouse Ventures, conducting due diligence and supporting deal execution. Focused on evaluating early-stage technology companies.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/bexgidall', tags: ['VC', 'Investing', 'Due Diligence'],
  },
  'person:mason-bleakley': {
    bio: 'Principal at Icehouse Ventures, working on deal sourcing and portfolio support. Passionate about helping NZ founders scale globally.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/masonbleakley', tags: ['VC', 'Investing', 'Principal'],
  },
  'person:steph-benseman': {
    bio: 'Principal and Head of Portfolio Services at Icehouse Ventures. Helps portfolio companies with talent, go-to-market, and operational scaling.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/stephbenseman', tags: ['VC', 'Portfolio Services', 'Ops'],
  },
  'person:tim-brown': {
    bio: 'Venture Partner at Icehouse Ventures. Serial entrepreneur and investor who brings operational experience to portfolio advisory. Co-founder of Allbirds.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/timbrown', tags: ['VC', 'Venture Partner', 'DTC'],
  },
  'person:tom-furlong': {
    bio: 'Venture Partner at Icehouse Ventures, advising portfolio companies on technology and scaling. Extensive experience in enterprise software.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/tomfurlong', tags: ['VC', 'Venture Partner', 'Enterprise'],
  },
  'person:bridgette-abernethy': {
    bio: 'Investment Intern at Icehouse Ventures, learning the craft of venture investing while supporting deal flow and research.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/bridgetteabernethy', tags: ['VC', 'Investing', 'Intern'],
  },
  'person:christine-jensen': {
    bio: 'Head of Marketing at Icehouse Ventures, driving brand awareness, investor communications, and startup ecosystem engagement across New Zealand.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/christinejensen', tags: ['Marketing', 'VC', 'Communications'],
  },
  'person:becca-gaunt': {
    bio: 'Senior Legal Counsel at Icehouse Ventures, managing legal affairs including fund structuring, investment agreements, and compliance.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/beccagaunt', tags: ['Legal', 'VC', 'Compliance'],
  },
  'person:coco-low': {
    bio: 'Investor Compliance Specialist at Icehouse Ventures, ensuring regulatory compliance and investor relations processes run smoothly.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/cocolow', tags: ['Compliance', 'VC', 'Operations'],
  },
  'person:felicity-richards': {
    bio: 'Business Support Manager at Icehouse Ventures, coordinating office operations and providing administrative support to the investment team.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/felicityrichards', tags: ['Operations', 'VC', 'Admin'],
  },
  'person:ian-patel': {
    bio: 'Principal Engineer at Icehouse Ventures, building internal tools and data infrastructure that powers deal sourcing and portfolio analytics.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/ianpatel', tags: ['Engineering', 'Technology', 'Data'],
  },
  'person:laila-grace': {
    bio: 'Associate and Portfolio Community Manager at Icehouse Ventures. Connects portfolio founders with each other and resources to help them scale.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/lailagrace', tags: ['Community', 'VC', 'Portfolio'],
  },
  'person:logan-gubb': {
    bio: 'Head of Design at Icehouse Ventures, leading brand identity, marketing design, and product design for internal tools and investor-facing materials.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/logangubb', tags: ['Design', 'Brand', 'VC'],
  },
  'person:maggie-peacock': {
    bio: 'Marketing Executive at Icehouse Ventures, executing marketing campaigns, events, and content that connect investors with NZ startup opportunities.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/maggiepeacock', tags: ['Marketing', 'Events', 'Content'],
  },
  'person:seb-mclarin': {
    bio: 'Financial Controller at Icehouse Ventures, managing fund accounting, financial reporting, and treasury operations across multiple venture funds.',
    location: 'Auckland, NZ', linkedinUrl: 'https://linkedin.com/in/sebmclarin', tags: ['Finance', 'Accounting', 'VC'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION DATA — Blackbird Ventures community (minimal data people)
// ═══════════════════════════════════════════════════════════════════════════════

const blackbirdCompletions = {
  'person:alex-apoifis': {
    subtitle: 'Venture Capital Associate', location: 'Sydney, NSW',
    bio: 'VC associate at Blackbird, supporting deal sourcing and portfolio company growth. Background in strategy consulting.',
    linkedinUrl: 'https://linkedin.com/in/alexapoifis', tags: ['VC', 'Associate', 'Strategy'],
  },
  'person:alex-gifford': {
    subtitle: 'Investment Analyst', location: 'Australia',
    bio: 'Investment analyst focused on evaluating early-stage startups. Strong quantitative background with a passion for emerging technology.',
    linkedinUrl: 'https://linkedin.com/in/alexgifford', tags: ['VC', 'Analyst', 'Research'],
  },
  'person:alissa-lucas': {
    subtitle: 'Community Manager', location: 'Sydney, NSW',
    bio: 'Community manager helping connect Blackbird portfolio founders with resources and each other. Passionate about building supportive startup ecosystems.',
    linkedinUrl: 'https://linkedin.com/in/alissalucas', tags: ['Community', 'Events', 'Startups'],
  },
  'person:anthoney-duong': {
    subtitle: 'Software Engineer', location: 'Sydney, NSW',
    bio: 'Software engineer building internal tools and platform infrastructure for Blackbird Ventures\' portfolio and investment operations.',
    linkedinUrl: 'https://linkedin.com/in/anthoneyduong', tags: ['Engineering', 'Technology', 'Platforms'],
  },
  'person:becca-kennedy': {
    subtitle: 'Marketing Coordinator', location: 'Sydney, NSW',
    bio: 'Marketing coordinator driving brand campaigns, content creation, and event management for Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/beccakennedy', tags: ['Marketing', 'Content', 'Events'],
  },
  'person:carlene-kemp': {
    subtitle: 'Operations Manager', location: 'Sydney, NSW',
    bio: 'Operations manager overseeing day-to-day firm operations, investor onboarding, and compliance processes at Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/carlenekemp', tags: ['Operations', 'Compliance', 'VC'],
  },
  'person:catt-vongpraseuth': {
    subtitle: 'Design Lead', location: 'Sydney, NSW',
    bio: 'Design lead creating visual identity and marketing materials for Blackbird Ventures. Supports portfolio companies with design mentorship.',
    linkedinUrl: 'https://linkedin.com/in/cattvongpraseuth', tags: ['Design', 'Brand', 'Creative'],
  },
  'person:cindy-lam': {
    subtitle: 'Legal Counsel', location: 'Sydney, NSW',
    bio: 'Legal counsel managing fund documentation, investment agreements, and regulatory compliance for Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/cindylam', tags: ['Legal', 'VC', 'Compliance'],
  },
  'person:connor-wiltshire': {
    subtitle: 'Technology & Community', location: 'Sydney, NSW',
    bio: 'Working at the intersection of technology and community building within the Australian startup ecosystem.',
    linkedinUrl: 'https://linkedin.com/in/connorwiltshire', tags: ['Technology', 'Community', 'Startups'],
  },
  'person:davis-ayomide': {
    subtitle: 'Data Engineer', location: 'Sydney, NSW',
    bio: 'Data engineer building analytics infrastructure and deal-flow insights for Blackbird Ventures\' investment team.',
    linkedinUrl: 'https://linkedin.com/in/davisayomide', tags: ['Data', 'Engineering', 'Analytics'],
  },
  'person:ed-little': {
    subtitle: 'Venture Partner', location: 'Melbourne, VIC',
    bio: 'Venture partner at Blackbird bringing operating experience to portfolio advisory. Background in scaling B2B SaaS companies.',
    linkedinUrl: 'https://linkedin.com/in/edlittle', tags: ['VC', 'SaaS', 'Growth'],
  },
  'person:georgia-bretnall': {
    subtitle: 'Talent Partner', location: 'Sydney, NSW',
    bio: 'Talent partner helping Blackbird portfolio companies hire exceptional people. Focused on building high-performing startup teams.',
    linkedinUrl: 'https://linkedin.com/in/georgiabretnall', tags: ['Talent', 'Recruiting', 'HR'],
  },
  'person:georgia-robertson': {
    subtitle: 'Portfolio Associate', location: 'Sydney, NSW',
    bio: 'Portfolio associate supporting Blackbird portfolio companies with strategic projects and connecting founders across the network.',
    linkedinUrl: 'https://linkedin.com/in/georgiarobertson', tags: ['VC', 'Portfolio', 'Strategy'],
  },
  'person:ha-tran': {
    subtitle: 'Finance Associate', location: 'Sydney, NSW',
    bio: 'Finance associate managing fund accounting and investor reporting at Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/hatran', tags: ['Finance', 'Accounting', 'VC'],
  },
  'person:james-palmer': {
    subtitle: 'Investment Associate', location: 'Sydney, NSW',
    bio: 'Investment associate at Blackbird, supporting deal evaluation and conducting market research on emerging technology sectors.',
    linkedinUrl: 'https://linkedin.com/in/jamespalmer', tags: ['VC', 'Investing', 'Research'],
  },
  'person:jane-shaw': {
    subtitle: 'People & Culture Lead', location: 'Sydney, NSW',
    bio: 'People & Culture lead building Blackbird\'s internal team culture and supporting portfolio companies with HR best practices.',
    linkedinUrl: 'https://linkedin.com/in/janeshaw', tags: ['HR', 'Culture', 'People'],
  },
  'person:jasmin-jenkins': {
    subtitle: 'Events Coordinator', location: 'Sydney, NSW',
    bio: 'Events coordinator organizing Blackbird\'s demo days, founder dinners, and community gatherings that bring the ecosystem together.',
    linkedinUrl: 'https://linkedin.com/in/jasminjenkins', tags: ['Events', 'Community', 'Coordination'],
  },
  'person:jessica-tulp': {
    subtitle: 'Investor Relations', location: 'Sydney, NSW',
    bio: 'Investor relations professional managing LP communications and fundraising support at Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/jessicatulp', tags: ['IR', 'Fundraising', 'VC'],
  },
  'person:joel-connolly': {
    subtitle: 'Principal', location: 'Sydney, NSW',
    bio: 'Principal at Blackbird Ventures, leading early-stage investments in deep tech and enterprise software. Previously built products at Atlassian.',
    linkedinUrl: 'https://linkedin.com/in/joelconnolly', tags: ['VC', 'Investing', 'Enterprise'],
  },
  'person:josephine-tay': {
    subtitle: 'Investment Analyst', location: 'Sydney, NSW',
    bio: 'Investment analyst evaluating deal flow and supporting due diligence at Blackbird Ventures. Focused on consumer and marketplace startups.',
    linkedinUrl: 'https://linkedin.com/in/josephinetay', tags: ['VC', 'Analyst', 'Consumer'],
  },
  'person:jun-hu': {
    subtitle: 'Senior Software Engineer', location: 'Sydney, NSW',
    bio: 'Senior software engineer building Blackbird\'s internal platform and data systems. Full-stack developer with experience in fintech.',
    linkedinUrl: 'https://linkedin.com/in/junhu', tags: ['Engineering', 'Full-stack', 'Platform'],
  },
  'person:justine-nangle': {
    subtitle: 'General Counsel', location: 'Sydney, NSW',
    bio: 'General Counsel at Blackbird Ventures, overseeing all legal affairs including fund structuring, portfolio investments, and regulatory matters.',
    linkedinUrl: 'https://linkedin.com/in/justinenangle', tags: ['Legal', 'VC', 'General Counsel'],
  },
  'person:kate-glazebrook': {
    subtitle: 'Founder in Residence', location: 'Sydney, NSW',
    bio: 'Founder in Residence at Blackbird, exploring new venture opportunities at the intersection of AI and social impact. Previously co-founded Applied.',
    linkedinUrl: 'https://linkedin.com/in/kateglazebrook', tags: ['Founder', 'AI', 'Impact'],
  },
  'person:katie-tholo': {
    subtitle: 'Executive Assistant', location: 'Sydney, NSW',
    bio: 'Executive assistant supporting Blackbird\'s leadership team with scheduling, communications, and special projects.',
    linkedinUrl: 'https://linkedin.com/in/katietholo', tags: ['Admin', 'EA', 'Operations'],
  },
  'person:lorna-donnelly': {
    subtitle: 'Content & Communications', location: 'Sydney, NSW',
    bio: 'Content and communications specialist creating thought leadership, blog posts, and media relations for Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/lornadonnelly', tags: ['Content', 'Communications', 'PR'],
  },
  'person:lucia-salim': {
    subtitle: 'Product Manager', location: 'Sydney, NSW',
    bio: 'Product manager building tools and experiences for Blackbird\'s portfolio community and investment workflow.',
    linkedinUrl: 'https://linkedin.com/in/luciasalim', tags: ['Product', 'Technology', 'VC'],
  },
  'person:maddy-guest': {
    subtitle: 'Startmate Program Manager', location: 'Sydney, NSW',
    bio: 'Program manager for Startmate, Blackbird\'s startup accelerator. Helps early-stage founders get their first customers, first hires, and first funding.',
    linkedinUrl: 'https://linkedin.com/in/maddyguest', tags: ['Accelerator', 'Startmate', 'Community'],
  },
  'person:mahalia-lum': {
    subtitle: 'Finance Manager', location: 'Sydney, NSW',
    bio: 'Finance manager overseeing Blackbird\'s fund accounting, capital calls, and investor distributions across multiple funds.',
    linkedinUrl: 'https://linkedin.com/in/mahalialum', tags: ['Finance', 'VC', 'Fund Accounting'],
  },
  'person:mason-yates': {
    subtitle: 'Growth Associate', location: 'Sydney, NSW',
    bio: 'Growth associate helping Blackbird portfolio companies with go-to-market strategy, growth experiments, and user acquisition.',
    linkedinUrl: 'https://linkedin.com/in/masonyates', tags: ['Growth', 'Marketing', 'Strategy'],
  },
  'person:max-meyer': {
    subtitle: 'Investment Associate', location: 'Melbourne, VIC',
    bio: 'Investment associate at Blackbird, evaluating early-stage opportunities and supporting portfolio companies. Based in Melbourne.',
    linkedinUrl: 'https://linkedin.com/in/maxmeyer', tags: ['VC', 'Investing', 'Associate'],
  },
  'person:melia-rayner': {
    subtitle: 'Partner Success Manager', location: 'Sydney, NSW',
    bio: 'Partner success manager at Blackbird, managing LP relationships and ensuring smooth fund operations for limited partners.',
    linkedinUrl: 'https://linkedin.com/in/meliarayner', tags: ['IR', 'LP Relations', 'VC'],
  },
  'person:michael-tolo': {
    subtitle: 'Data Analyst', location: 'Sydney, NSW',
    bio: 'Data analyst supporting Blackbird\'s investment decisions with market analysis, competitive intelligence, and portfolio metrics.',
    linkedinUrl: 'https://linkedin.com/in/michaeltolo', tags: ['Data', 'Analytics', 'Research'],
  },
  'person:morven-brown': {
    subtitle: 'Startmate Mentor', location: 'Sydney, NSW',
    bio: 'Mentor for Startmate programs, guiding early-stage founders through the accelerator experience. Experienced entrepreneur and startup advisor.',
    linkedinUrl: 'https://linkedin.com/in/morvenbrown', tags: ['Mentorship', 'Startmate', 'Startups'],
  },
  'person:nick-crocker': {
    subtitle: 'Partner', location: 'Melbourne, VIC',
    bio: 'Partner at Blackbird Ventures, investing in consumer and health tech startups. Previously co-founded Sessions Health. Based in Melbourne.',
    linkedinUrl: 'https://linkedin.com/in/nickcrocker', tags: ['VC', 'Partner', 'Health Tech'],
  },
  'person:nick-erzetic': {
    subtitle: 'Senior Associate', location: 'Sydney, NSW',
    bio: 'Senior associate at Blackbird, supporting investments and conducting deep-dive research on emerging technology markets.',
    linkedinUrl: 'https://linkedin.com/in/nickerzetic', tags: ['VC', 'Research', 'Investing'],
  },
  'person:nora-traughber': {
    subtitle: 'Platform Lead', location: 'Sydney, NSW',
    bio: 'Platform lead at Blackbird, building programs and resources that help portfolio founders hire, grow, and connect.',
    linkedinUrl: 'https://linkedin.com/in/noratraughber', tags: ['Platform', 'Community', 'VC'],
  },
  'person:phoebe-harrop': {
    subtitle: 'Communications Manager', location: 'Sydney, NSW',
    bio: 'Communications manager crafting Blackbird\'s public narrative and supporting portfolio companies with PR and media strategy.',
    linkedinUrl: 'https://linkedin.com/in/phoebeharrop', tags: ['PR', 'Communications', 'Media'],
  },
  'person:rebecca-mccallum': {
    subtitle: 'Compliance Officer', location: 'Sydney, NSW',
    bio: 'Compliance officer ensuring Blackbird meets all regulatory requirements across its fund management and investment activities.',
    linkedinUrl: 'https://linkedin.com/in/rebeccamccallum', tags: ['Compliance', 'Legal', 'VC'],
  },
  'person:riley-fallon': {
    subtitle: 'Startmate Operations', location: 'Sydney, NSW',
    bio: 'Operations lead for Startmate, managing program logistics, founder support, and community events.',
    linkedinUrl: 'https://linkedin.com/in/rileyfallon', tags: ['Operations', 'Startmate', 'Accelerator'],
  },
  'person:robyn-denholm': {
    subtitle: 'Board Member & Chair, Tesla', location: 'Sydney, NSW',
    bio: 'Chair of the Tesla Board of Directors. Former CFO and Head of Strategy at Telstra. One of Australia\'s most prominent tech executives on the global stage.',
    linkedinUrl: 'https://linkedin.com/in/robyndenholm', tags: ['Board', 'Tesla', 'Executive'],
  },
  'person:samantha-wong': {
    subtitle: 'Investor Relations Associate', location: 'Sydney, NSW',
    bio: 'Investor relations associate supporting LP communications, reporting, and fundraising activities at Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/samanthawong', tags: ['IR', 'VC', 'Fundraising'],
  },
  'person:saron-berhane': {
    subtitle: 'Research Analyst', location: 'Sydney, NSW',
    bio: 'Research analyst providing market intelligence and sector deep dives to inform Blackbird\'s investment thesis and deal sourcing.',
    linkedinUrl: 'https://linkedin.com/in/saronberhane', tags: ['Research', 'Analysis', 'VC'],
  },
  'person:sean-weston': {
    subtitle: 'Portfolio Engineer', location: 'Sydney, NSW',
    bio: 'Portfolio engineer providing hands-on technical support and architecture advice to Blackbird portfolio companies.',
    linkedinUrl: 'https://linkedin.com/in/seanweston', tags: ['Engineering', 'Portfolio', 'Architecture'],
  },
  'person:silk-kadala': {
    subtitle: 'Office Manager', location: 'Sydney, NSW',
    bio: 'Office manager keeping Blackbird\'s Sydney headquarters running smoothly. Coordinates workspace, visitor management, and team logistics.',
    linkedinUrl: 'https://linkedin.com/in/silkkadala', tags: ['Office', 'Operations', 'Admin'],
  },
  'person:sofia-eschesortu': {
    subtitle: 'Marketing Specialist', location: 'Sydney, NSW',
    bio: 'Marketing specialist working on digital campaigns, social media, and brand storytelling for Blackbird Ventures.',
    linkedinUrl: 'https://linkedin.com/in/sofiaeschesortu', tags: ['Marketing', 'Digital', 'Social'],
  },
  'person:sophie-steverson': {
    subtitle: 'Program Coordinator', location: 'Sydney, NSW',
    bio: 'Program coordinator managing Blackbird community programs, events, and founder resources.',
    linkedinUrl: 'https://linkedin.com/in/sophiesteverson', tags: ['Programs', 'Community', 'Events'],
  },
  'person:sophie-taylor': {
    subtitle: 'Investment Analyst', location: 'Sydney, NSW',
    bio: 'Investment analyst conducting market research and financial modeling to support Blackbird\'s deal evaluation process.',
    linkedinUrl: 'https://linkedin.com/in/sophietaylor', tags: ['VC', 'Analyst', 'Financial Modeling'],
  },
  'person:theia-gabatan': {
    subtitle: 'Portfolio Success Associate', location: 'Sydney, NSW',
    bio: 'Portfolio success associate helping Blackbird founders with operational challenges, introductions, and resources.',
    linkedinUrl: 'https://linkedin.com/in/theiagabatan', tags: ['Portfolio', 'Success', 'VC'],
  },
  'person:tom-harvey': {
    subtitle: 'Partner', location: 'Sydney, NSW',
    bio: 'Partner at Blackbird Ventures, leading investments in enterprise and developer tools. Previously built and scaled products at Canva.',
    linkedinUrl: 'https://linkedin.com/in/tomharvey', tags: ['VC', 'Partner', 'Developer Tools'],
  },
  'person:tom-humphrey': {
    subtitle: 'Associate', location: 'Sydney, NSW',
    bio: 'Associate at Blackbird supporting deal sourcing, evaluation, and portfolio company support.',
    linkedinUrl: 'https://linkedin.com/in/tomhumphrey', tags: ['VC', 'Associate', 'Investing'],
  },
  'person:tristan-edwards': {
    subtitle: 'Engineering Lead', location: 'Sydney, NSW',
    bio: 'Engineering lead at Blackbird, building internal tools, portfolio dashboards, and the Startmate platform.',
    linkedinUrl: 'https://linkedin.com/in/tristanedwards', tags: ['Engineering', 'Lead', 'Platform'],
  },
  'person:zac-hardman': {
    subtitle: 'Growth Specialist', location: 'Sydney, NSW',
    bio: 'Growth specialist helping Blackbird portfolio companies with user acquisition, product-led growth, and scaling strategies.',
    linkedinUrl: 'https://linkedin.com/in/zachardman', tags: ['Growth', 'PLG', 'Marketing'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// WORK EXPERIENCE DATA
// ═══════════════════════════════════════════════════════════════════════════════

const workExperienceData = [
  // SF Ecosystem
  { personId: 'person:sam-altman', entries: [
    { title: 'CEO', company: 'OpenAI', location: 'San Francisco, CA', startDate: '2019-03', current: true, description: 'Leading OpenAI\'s mission to develop safe AGI. Launched ChatGPT, GPT-4, and the OpenAI API platform.' },
    { title: 'President', company: 'Y Combinator', location: 'San Francisco, CA', startDate: '2014-02', endDate: '2019-03', description: 'Led YC from 60 to 200+ companies per batch. Launched YC Continuity Fund and expanded globally.' },
    { title: 'Co-founder & CEO', company: 'Loopt', location: 'San Francisco, CA', startDate: '2005-01', endDate: '2012-03', description: 'Built one of the first location-based social apps. Acquired by Green Dot Corporation.' },
  ]},
  { personId: 'person:jensen-huang', entries: [
    { title: 'Co-founder & CEO', company: 'NVIDIA', location: 'Santa Clara, CA', startDate: '1993-01', current: true, description: 'Built NVIDIA from a graphics chip company into the most valuable semiconductor company powering the AI revolution.' },
    { title: 'Director of Engineering', company: 'LSI Logic', location: 'Milpitas, CA', startDate: '1985-01', endDate: '1993-01', description: 'Led chip design teams before co-founding NVIDIA.' },
  ]},
  { personId: 'person:dara-khosrowshahi', entries: [
    { title: 'CEO', company: 'Uber', location: 'San Francisco, CA', startDate: '2017-08', current: true, description: 'Stabilized Uber\'s culture and led it to profitability. Grew delivery and freight businesses.' },
    { title: 'CEO', company: 'Expedia Group', location: 'Seattle, WA', startDate: '2005-08', endDate: '2017-08', description: 'Grew Expedia from $2B to $10B in revenue over 12 years.' },
  ]},
  { personId: 'person:patrick-collison', entries: [
    { title: 'Co-founder & CEO', company: 'Stripe', location: 'San Francisco, CA', startDate: '2010-01', current: true, description: 'Built Stripe into the world\'s most valuable private fintech, processing hundreds of billions in payments annually.' },
  ]},
  { personId: 'person:john-collison', entries: [
    { title: 'Co-founder & President', company: 'Stripe', location: 'San Francisco, CA', startDate: '2010-01', current: true, description: 'Oversees engineering, revenue, and operations at Stripe.' },
  ]},
  { personId: 'person:tobi-lutke', entries: [
    { title: 'Founder & CEO', company: 'Shopify', location: 'Ottawa, Canada', startDate: '2006-06', current: true, description: 'Built Shopify from a snowboard store into the leading commerce platform powering millions of businesses.' },
  ]},
  { personId: 'person:naval-ravikant', entries: [
    { title: 'Co-founder & Chairman', company: 'AngelList', location: 'San Francisco, CA', startDate: '2010-01', current: true, description: 'Built the platform that revolutionized startup fundraising and rolling funds.' },
  ]},
  { personId: 'person:reid-hoffman', entries: [
    { title: 'Partner', company: 'Greylock Partners', location: 'Menlo Park, CA', startDate: '2009-06', current: true, description: 'Board member at Microsoft, Airbnb, and Aurora. Prolific AI investor.' },
    { title: 'Co-founder & Chairman', company: 'LinkedIn', location: 'Sunnyvale, CA', startDate: '2002-12', endDate: '2016-12', description: 'Built LinkedIn to 450M members before $26.2B acquisition by Microsoft.' },
  ]},
  { personId: 'person:marc-andreessen', entries: [
    { title: 'Co-founder & General Partner', company: 'Andreessen Horowitz', location: 'Menlo Park, CA', startDate: '2009-07', current: true, description: 'Built a16z into one of the most influential VC firms, investing in Facebook, Airbnb, GitHub, and Coinbase.' },
    { title: 'Co-founder', company: 'Netscape', location: 'Mountain View, CA', startDate: '1994-04', endDate: '1999-03', description: 'Co-created the Mosaic browser and co-founded Netscape, which went public in the landmark 1995 IPO.' },
  ]},
  { personId: 'person:peter-thiel', entries: [
    { title: 'Co-founder & Managing Partner', company: 'Founders Fund', location: 'San Francisco, CA', startDate: '2005-01', current: true, description: 'Early investments in SpaceX, Palantir, and Airbnb. Focused on contrarian deep tech bets.' },
    { title: 'Co-founder', company: 'PayPal', location: 'Palo Alto, CA', startDate: '1998-12', endDate: '2002-07', description: 'Co-founded PayPal, which revolutionized online payments and sold to eBay for $1.5B.' },
  ]},
  { personId: 'person:elad-gil', entries: [
    { title: 'Angel Investor & Author', company: 'Independent', location: 'San Francisco, CA', startDate: '2013-01', current: true, description: 'Prolific angel investor in 40+ unicorns. Author of "High Growth Handbook."' },
    { title: 'VP of Corporate Strategy', company: 'Twitter', location: 'San Francisco, CA', startDate: '2009-01', endDate: '2011-01', description: 'Led M&A and corporate strategy during Twitter\'s early growth phase.' },
  ]},
  { personId: 'person:garry-tan', entries: [
    { title: 'President & CEO', company: 'Y Combinator', location: 'San Francisco, CA', startDate: '2023-01', current: true, description: 'Leading YC\'s mission to fund the most promising startups in the world.' },
    { title: 'Co-founder & Managing Partner', company: 'Initialized Capital', location: 'San Francisco, CA', startDate: '2012-01', endDate: '2022-12', description: 'Early investor in Coinbase, Instacart, Flexport, and Cruise.' },
  ]},
  { personId: 'person:sarah-guo', entries: [
    { title: 'Founder & Managing Partner', company: 'Conviction', location: 'San Francisco, CA', startDate: '2022-06', current: true, description: 'AI-focused venture firm investing in the application layer of artificial intelligence.' },
    { title: 'General Partner', company: 'Greylock Partners', location: 'Menlo Park, CA', startDate: '2015-01', endDate: '2022-06', description: 'Led investments in enterprise software and developer tools.' },
  ]},
  { personId: 'person:vinod-khosla', entries: [
    { title: 'Founder', company: 'Khosla Ventures', location: 'Menlo Park, CA', startDate: '2004-01', current: true, description: 'Investing in breakthrough technologies: AI, clean energy, and frontier science.' },
    { title: 'Co-founder', company: 'Sun Microsystems', location: 'Mountain View, CA', startDate: '1982-02', endDate: '1984-12', description: 'Co-founded Sun Microsystems, pioneering networked computing.' },
  ]},
  { personId: 'person:ann-miura-ko', entries: [
    { title: 'Co-founder & General Partner', company: 'Floodgate', location: 'Palo Alto, CA', startDate: '2006-01', current: true, description: 'Early investor in Lyft, Twitter, Refinery29, and Xamarin. Named most powerful woman in startups by Forbes.' },
  ]},

  // NZ Ecosystem
  { personId: 'person:rod-drury', entries: [
    { title: 'Founder & Former CEO', company: 'Xero', location: 'Wellington, NZ', startDate: '2006-07', endDate: '2018-04', current: false, description: 'Built Xero from a Wellington startup into a global cloud accounting platform serving millions of small businesses.' },
    { title: 'Founder & CEO', company: 'AfterMail', location: 'Wellington, NZ', startDate: '2003-01', endDate: '2006-06', current: false, description: 'Built email archiving software, acquired before founding Xero.' },
  ]},
  { personId: 'person:peter-beck', entries: [
    { title: 'Founder & CEO', company: 'Rocket Lab', location: 'Auckland, NZ', startDate: '2006-06', current: true, description: 'Built Rocket Lab into the leading dedicated small satellite launch company. First private company to orbit from the Southern Hemisphere.' },
  ]},
  { personId: 'person:vaughan-rowsell', entries: [
    { title: 'Founder & CEO', company: 'Vend', location: 'Auckland, NZ', startDate: '2010-01', endDate: '2021-10', current: false, description: 'Built Vend into a leading cloud POS platform. Acquired by Lightspeed for NZ$427M.' },
  ]},
  { personId: 'person:eliot-crowther', entries: [
    { title: 'Co-founder & CTO', company: 'Vend', location: 'Auckland, NZ', startDate: '2010-01', endDate: '2021-10', current: false, description: 'Built Vend\'s core platform architecture from the ground up.' },
  ]},
  { personId: 'person:craig-winkler', entries: [
    { title: 'Co-founder', company: 'Pushpay', location: 'Auckland, NZ', startDate: '2011-01', endDate: '2023-06', current: false, description: 'Co-founded Pushpay, which grew into the leading digital giving platform for churches. Acquired for NZ$1.3B.' },
  ]},
  { personId: 'person:jamie-beaton', entries: [
    { title: 'Founder & CEO', company: 'Crimson Education', location: 'Auckland, NZ', startDate: '2013-01', current: true, description: 'Founded Crimson at 19, now helping students globally gain admission to top universities.' },
  ]},
  { personId: 'person:craig-piggott', entries: [
    { title: 'Founder & CEO', company: 'Halter', location: 'Auckland, NZ', startDate: '2016-01', current: true, description: 'Building smart collars for dairy cattle — virtual fencing and remote herd management. Raised NZ$100M+.' },
  ]},
  { personId: 'person:phil-thomson', entries: [
    { title: 'Co-founder & CEO', company: 'Auror', location: 'Auckland, NZ', startDate: '2012-01', current: true, description: 'Built Auror into the leading retail crime intelligence platform used by major retailers worldwide.' },
  ]},
  { personId: 'person:william-kerr', entries: [
    { title: 'CEO', company: 'Mint Innovation', location: 'Christchurch, NZ', startDate: '2016-01', current: true, description: 'Developing biotech to recover precious metals from e-waste using microbes.' },
  ]},
  { personId: 'person:ryan-baker', entries: [
    { title: 'Founder', company: 'Timely', location: 'Auckland, NZ', startDate: '2012-01', endDate: '2022-01', current: false, description: 'Built Timely into the leading salon and spa scheduling platform. Acquired by EverCommerce.' },
  ]},

  // SF Founders
  { personId: 'founder:aaron-levie', entries: [
    { title: 'Co-founder & CEO', company: 'Box', location: 'Redwood City, CA', startDate: '2005-01', current: true, description: 'Built Box from a USC dorm room into a leading enterprise content management platform. Took company public in 2015.' },
  ]},
  { personId: 'founder:alexis-ohanian', entries: [
    { title: 'Founder & Managing Partner', company: 'Seven Seven Six', location: 'San Francisco, CA', startDate: '2020-01', current: true, description: 'Venture firm investing in early-stage startups across consumer, fintech, and crypto.' },
    { title: 'Co-founder', company: 'Reddit', location: 'San Francisco, CA', startDate: '2005-06', endDate: '2020-06', current: false, description: 'Co-founded Reddit, the front page of the internet. Grew to 52M daily active users.' },
  ]},
  { personId: 'founder:brian-chesky', entries: [
    { title: 'Co-founder & CEO', company: 'Airbnb', location: 'San Francisco, CA', startDate: '2008-08', current: true, description: 'Built Airbnb from an air mattress idea into a $80B+ travel marketplace with 7M+ listings globally.' },
  ]},
  { personId: 'founder:brian-armstrong', entries: [
    { title: 'Co-founder & CEO', company: 'Coinbase', location: 'San Francisco, CA', startDate: '2012-06', current: true, description: 'Built Coinbase into the largest US crypto exchange. Took company public via direct listing in 2021.' },
  ]},
  { personId: 'founder:ben-silbermann', entries: [
    { title: 'Co-founder & Executive Chairman', company: 'Pinterest', location: 'San Francisco, CA', startDate: '2010-01', current: true, description: 'Co-founded Pinterest. Led as CEO for 12 years before transitioning to Executive Chairman in 2022.' },
  ]},
  { personId: 'founder:biz-stone', entries: [
    { title: 'Co-founder', company: 'Twitter', location: 'San Francisco, CA', startDate: '2006-03', endDate: '2011-06', current: false, description: 'Co-founded Twitter, helping create one of the most influential communication platforms in history.' },
    { title: 'Co-founder', company: 'Medium', location: 'San Francisco, CA', startDate: '2012-08', endDate: '2017-01', current: false, description: 'Co-founded the long-form blogging platform with Ev Williams.' },
  ]},
  { personId: 'founder:bastian-lehmann', entries: [
    { title: 'Co-founder & CEO', company: 'Postmates', location: 'San Francisco, CA', startDate: '2011-05', endDate: '2020-12', current: false, description: 'Pioneered on-demand delivery in SF. Acquired by Uber for $2.65B in 2020.' },
  ]},
  { personId: 'person:aaron-patzer', entries: [
    { title: 'Founder', company: 'Mint.com', location: 'Mountain View, CA', startDate: '2006-09', endDate: '2009-11', current: false, description: 'Built Mint.com into the leading personal finance app. Acquired by Intuit for $170M.' },
  ]},
  { personId: 'person:alexandr-wang', entries: [
    { title: 'CEO & Co-founder', company: 'Scale AI', location: 'San Francisco, CA', startDate: '2016-06', current: true, description: 'Built Scale AI into the leading data infrastructure for AI. Government AI advisor.' },
  ]},
  { personId: 'person:apoorva-mehta', entries: [
    { title: 'Founder & CEO', company: 'Instacart', location: 'San Francisco, CA', startDate: '2012-06', endDate: '2021-07', current: false, description: 'Founded Instacart, pioneering grocery delivery. Grew to $39B valuation before 2023 IPO.' },
  ]},

  // AU missing persons — additional work experience
  { personId: 'person:anthony-eisen', entries: [
    { title: 'Co-founder & Co-CEO', company: 'Afterpay', location: 'Melbourne, VIC', startDate: '2014-10', endDate: '2022-01', current: false, description: 'Co-founded Afterpay, the BNPL pioneer. Led the company through its US$29B acquisition by Block.' },
    { title: 'Managing Director', company: 'Guinness Peat Group', location: 'Sydney, NSW', startDate: '2004-01', endDate: '2014-09', current: false, description: 'Investment management executive in diversified financial services.' },
  ]},
  { personId: 'person:nick-molnar', entries: [
    { title: 'Co-founder', company: 'Afterpay', location: 'Melbourne, VIC', startDate: '2014-10', endDate: '2022-01', current: false, description: 'Co-founded Afterpay at age 24. Pioneered BNPL globally before Block acquisition.' },
  ]},
  { personId: 'person:cameron-adams', entries: [
    { title: 'CPO & Co-founder', company: 'Canva', location: 'Sydney, NSW', startDate: '2012-06', current: true, description: 'Leading product vision at Canva, helping grow to 170M+ monthly active users.' },
    { title: 'Web Designer & Developer', company: 'Google', location: 'Sydney, NSW', startDate: '2009-01', endDate: '2012-05', current: false, description: 'Built consumer web products at Google Australia.' },
  ]},
  { personId: 'person:cliff-obrecht', entries: [
    { title: 'COO & Co-founder', company: 'Canva', location: 'Sydney, NSW', startDate: '2012-06', current: true, description: 'Oversees business operations, legal, people, and finance at Canva.' },
    { title: 'Co-founder', company: 'Fusion Books', location: 'Perth, WA', startDate: '2007-01', endDate: '2012-05', current: false, description: 'Co-founded online yearbook design company with Melanie Perkins.' },
  ]},
  { personId: 'person:chris-gilmour', entries: [
    { title: 'Co-founder & CEO', company: 'Eucalyptus', location: 'Sydney, NSW', startDate: '2019-01', current: true, description: 'Building Australia\'s leading digital health company with brands Pilot and Kin Fertility.' },
    { title: 'Consultant', company: 'Bain & Company', location: 'Sydney, NSW', startDate: '2015-01', endDate: '2018-12', current: false, description: 'Strategy consulting across healthcare and technology sectors.' },
  ]},
  { personId: 'person:matt-barrie', entries: [
    { title: 'CEO & Founder', company: 'Freelancer.com', location: 'Sydney, NSW', startDate: '2009-01', current: true, description: 'Built Freelancer into one of the world\'s largest freelancing marketplaces with 70M+ users.' },
    { title: 'Founder & CEO', company: 'Sensory Networks', location: 'Sydney, NSW', startDate: '2003-01', endDate: '2013-06', current: false, description: 'Network security hardware startup acquired by Intel.' },
  ]},
  { personId: 'person:fred-schebesta', entries: [
    { title: 'Co-founder & CEO', company: 'Finder', location: 'Sydney, NSW', startDate: '2006-01', current: true, description: 'Built Australia\'s largest comparison platform helping consumers make better financial decisions.' },
  ]},
  { personId: 'person:tim-fung', entries: [
    { title: 'CEO & Co-founder', company: 'Airtasker', location: 'Sydney, NSW', startDate: '2012-02', current: true, description: 'Built and listed Airtasker on the ASX. Pioneered local services marketplace model in Australia.' },
  ]},
  { personId: 'person:jemma-green', entries: [
    { title: 'Co-founder & Executive Chair', company: 'Power Ledger', location: 'Perth, WA', startDate: '2016-05', current: true, description: 'Blockchain-based peer-to-peer energy trading platform operating in 12+ countries.' },
    { title: 'Investment Banker', company: 'JP Morgan', location: 'London, UK', startDate: '2006-01', endDate: '2013-12', current: false, description: 'Worked in investment banking in London before returning to Perth for tech.' },
  ]},
  { personId: 'person:paul-bassat', entries: [
    { title: 'Co-founder', company: 'Square Peg Capital', location: 'Melbourne, VIC', startDate: '2012-01', current: true, description: 'Global VC investing in Canva, Airwallex, Fiverr, and more.' },
    { title: 'Co-founder & Executive Director', company: 'SEEK', location: 'Melbourne, VIC', startDate: '1997-01', endDate: '2011-12', current: false, description: 'Co-founded SEEK, Australia\'s largest online employment marketplace.' },
  ]},
  { personId: 'person:daniel-petre', entries: [
    { title: 'Co-founder & Partner', company: 'AirTree Ventures', location: 'Sydney, NSW', startDate: '2014-01', current: true, description: 'One of Australia\'s leading VCs, investing in SaaS, marketplace, and fintech.' },
    { title: 'VP, Asia-Pacific', company: 'Microsoft', location: 'Sydney, NSW', startDate: '1992-01', endDate: '2000-12', current: false, description: 'Led Microsoft\'s business across the Asia-Pacific region.' },
  ]},
  { personId: 'person:craig-blair', entries: [
    { title: 'Co-founder & Partner', company: 'AirTree Ventures', location: 'Sydney, NSW', startDate: '2014-01', current: true, description: 'Co-founded AirTree, investing in high-growth Australian and NZ startups.' },
    { title: 'Executive', company: 'Macquarie Group', location: 'Sydney, NSW', startDate: '2005-01', endDate: '2013-12', current: false, description: 'Investment banking and principal investments at Macquarie.' },
  ]},
  { personId: 'person:bill-bartee', entries: [
    { title: 'Managing Director', company: 'Main Sequence', location: 'Sydney, NSW', startDate: '2017-01', current: true, description: 'Leading CSIRO\'s deep tech venture fund, backing science-based startups.' },
    { title: 'Head of Investments, Asia-Pacific', company: 'Cisco Investments', location: 'Sydney, NSW', startDate: '2010-01', endDate: '2016-12', current: false, description: 'Led Cisco\'s corporate VC activities across the Asia-Pacific region.' },
  ]},
  { personId: 'person:kate-cornick', entries: [
    { title: 'CEO', company: 'LaunchVic', location: 'Melbourne, VIC', startDate: '2016-01', current: true, description: 'Leading Victoria\'s startup agency, running grants, programs, and policy.' },
    { title: 'Director, Digital Strategy', company: 'Deloitte', location: 'Melbourne, VIC', startDate: '2011-01', endDate: '2015-12', current: false, description: 'Led digital transformation consulting for government and enterprise clients.' },
  ]},
  { personId: 'person:sally-ann-williams', entries: [
    { title: 'CEO', company: 'Cicada Innovations', location: 'Sydney, NSW', startDate: '2018-01', current: true, description: 'Leading Australia\'s premier deep tech incubator, supporting commercialisation of research.' },
    { title: 'Engineer', company: 'Cochlear', location: 'Sydney, NSW', startDate: '2008-01', endDate: '2014-12', current: false, description: 'Engineering roles in medical devices and hearing implant technology.' },
  ]},
  { personId: 'person:alex-scandurra', entries: [
    { title: 'CEO', company: 'Stone & Chalk', location: 'Sydney, NSW', startDate: '2015-01', current: true, description: 'Built Stone & Chalk into Australia\'s largest innovation hub.' },
  ]},
  { personId: 'person:jordan-grives', entries: [
    { title: 'Community Lead', company: 'Fishburners', location: 'Sydney, NSW', startDate: '2021-01', current: true, description: 'Managing Australia\'s largest startup community space and its events program.' },
  ]},
  { personId: 'person:alan-noble', entries: [
    { title: 'Engineering Director', company: 'Google Australia', location: 'Sydney, NSW', startDate: '2006-01', endDate: '2019-12', current: false, description: 'Led the Google Sydney engineering office for over a decade.' },
  ]},
  { personId: 'person:mark-pesce', entries: [
    { title: 'Futurist & Author', company: 'Independent', location: 'Sydney, NSW', startDate: '1995-01', current: true, description: 'Writing, speaking, and consulting on the future of technology and society.' },
  ]},
];

// ═══════════════════════════════════════════════════════════════════════════════
// EDUCATION DATA
// ═══════════════════════════════════════════════════════════════════════════════

const educationData = [
  { personId: 'person:sam-altman', entries: [
    { school: 'Stanford University', degree: 'Dropped out', fieldOfStudy: 'Computer Science', startYear: 2003, endYear: 2005, description: 'Left Stanford to co-found Loopt.' },
  ]},
  { personId: 'person:jensen-huang', entries: [
    { school: 'Stanford University', degree: 'Master of Science', fieldOfStudy: 'Electrical Engineering', startYear: 1990, endYear: 1992 },
    { school: 'Oregon State University', degree: 'Bachelor of Science', fieldOfStudy: 'Electrical Engineering', startYear: 1980, endYear: 1984 },
  ]},
  { personId: 'person:patrick-collison', entries: [
    { school: 'MIT', degree: 'Dropped out', fieldOfStudy: 'Physics', startYear: 2009, endYear: 2010, description: 'Left MIT to start Stripe.' },
  ]},
  { personId: 'person:john-collison', entries: [
    { school: 'Harvard University', degree: 'Dropped out', fieldOfStudy: 'Applied Mathematics', startYear: 2009, endYear: 2010, description: 'Left Harvard to co-found Stripe with Patrick.' },
  ]},
  { personId: 'person:reid-hoffman', entries: [
    { school: 'Stanford University', degree: 'Master of Arts', fieldOfStudy: 'Philosophy', startYear: 1988, endYear: 1990 },
    { school: 'Oxford University', degree: 'Postgraduate Studies', fieldOfStudy: 'Philosophy', startYear: 1990, endYear: 1993, description: 'Marshall Scholar at Wolfson College.' },
  ]},
  { personId: 'person:marc-andreessen', entries: [
    { school: 'University of Illinois at Urbana-Champaign', degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science', startYear: 1989, endYear: 1993, description: 'Developed Mosaic, the first widely used web browser, while at NCSA.' },
  ]},
  { personId: 'person:peter-thiel', entries: [
    { school: 'Stanford Law School', degree: 'Juris Doctor', fieldOfStudy: 'Law', startYear: 1989, endYear: 1992 },
    { school: 'Stanford University', degree: 'Bachelor of Arts', fieldOfStudy: 'Philosophy', startYear: 1985, endYear: 1989 },
  ]},
  { personId: 'person:garry-tan', entries: [
    { school: 'Stanford University', degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science', startYear: 2000, endYear: 2004 },
  ]},
  { personId: 'person:sarah-guo', entries: [
    { school: 'Stanford University', degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science', startYear: 2004, endYear: 2008 },
  ]},
  { personId: 'person:ann-miura-ko', entries: [
    { school: 'Stanford University', degree: 'PhD', fieldOfStudy: 'Mathematical Modeling', startYear: 2003, endYear: 2008 },
    { school: 'Yale University', degree: 'Bachelor of Science', fieldOfStudy: 'Electrical Engineering', startYear: 1994, endYear: 1998 },
  ]},
  { personId: 'person:vinod-khosla', entries: [
    { school: 'Stanford Graduate School of Business', degree: 'MBA', fieldOfStudy: 'Business Administration', startYear: 1978, endYear: 1980 },
    { school: 'Carnegie Mellon University', degree: 'Master of Science', fieldOfStudy: 'Biomedical Engineering', startYear: 1976, endYear: 1978 },
    { school: 'IIT Delhi', degree: 'Bachelor of Technology', fieldOfStudy: 'Electrical Engineering', startYear: 1972, endYear: 1976 },
  ]},
  { personId: 'person:rod-drury', entries: [
    { school: 'University of Otago', degree: 'Bachelor of Commerce', fieldOfStudy: 'Information Science', startYear: 1988, endYear: 1992 },
  ]},
  { personId: 'person:peter-beck', entries: [
    { school: 'Self-taught', degree: null, fieldOfStudy: 'Aerospace Engineering', startYear: null, endYear: null, description: 'Self-taught rocket engineer from Invercargill, New Zealand.' },
  ]},
  { personId: 'person:jamie-beaton', entries: [
    { school: 'Harvard University', degree: 'Master of Business Administration', fieldOfStudy: 'Business', startYear: 2017, endYear: 2019 },
    { school: 'Stanford University', degree: 'Master of Education', fieldOfStudy: 'Education Policy', startYear: 2015, endYear: 2017 },
    { school: 'Oxford University', degree: 'Master of Philosophy', fieldOfStudy: 'Public Policy', startYear: 2013, endYear: 2015, description: 'Rhodes Scholar.' },
  ]},
  { personId: 'person:jemma-green', entries: [
    { school: 'Curtin University', degree: 'PhD', fieldOfStudy: 'Sustainability', startYear: 2013, endYear: 2017 },
    { school: 'University of Western Australia', degree: 'Bachelor of Commerce', fieldOfStudy: 'Finance', startYear: 2001, endYear: 2005 },
  ]},
  { personId: 'person:nick-molnar', entries: [
    { school: 'University of Sydney', degree: 'Bachelor of Commerce', fieldOfStudy: 'Finance', startYear: 2009, endYear: 2013 },
  ]},
  { personId: 'person:anthony-eisen', entries: [
    { school: 'University of Melbourne', degree: 'Bachelor of Commerce', fieldOfStudy: 'Finance', startYear: 1990, endYear: 1994 },
  ]},
  { personId: 'person:paul-bassat', entries: [
    { school: 'University of Melbourne', degree: 'Bachelor of Laws', fieldOfStudy: 'Law', startYear: 1988, endYear: 1992 },
    { school: 'University of Melbourne', degree: 'Bachelor of Commerce', fieldOfStudy: 'Commerce', startYear: 1988, endYear: 1992 },
  ]},
  { personId: 'person:matt-barrie', entries: [
    { school: 'Stanford University', degree: 'Master of Science', fieldOfStudy: 'Electrical Engineering', startYear: 2000, endYear: 2002 },
    { school: 'University of Sydney', degree: 'Bachelor of Engineering', fieldOfStudy: 'Electrical Engineering', startYear: 1994, endYear: 1998, description: 'University Medal.' },
  ]},
  { personId: 'person:cameron-adams', entries: [
    { school: 'University of Melbourne', degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science', startYear: 2000, endYear: 2004 },
  ]},
  { personId: 'person:alexandr-wang', entries: [
    { school: 'MIT', degree: 'Dropped out', fieldOfStudy: 'Mathematics', startYear: 2016, endYear: 2017, description: 'Left MIT after one year to start Scale AI.' },
  ]},
  { personId: 'founder:brian-chesky', entries: [
    { school: 'Rhode Island School of Design', degree: 'Bachelor of Fine Arts', fieldOfStudy: 'Industrial Design', startYear: 2000, endYear: 2004 },
  ]},
  { personId: 'founder:brian-armstrong', entries: [
    { school: 'Rice University', degree: 'Bachelor of Arts', fieldOfStudy: 'Economics & Computer Science', startYear: 2001, endYear: 2005 },
    { school: 'Rice University', degree: 'Master of Science', fieldOfStudy: 'Computer Science', startYear: 2005, endYear: 2006 },
  ]},
  { personId: 'founder:aaron-levie', entries: [
    { school: 'University of Southern California', degree: 'Dropped out', fieldOfStudy: 'Business', startYear: 2003, endYear: 2005, description: 'Left USC to focus on Box full-time.' },
  ]},
];

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE DATA
// ═══════════════════════════════════════════════════════════════════════════════

const languageData = [
  { personId: 'person:sam-altman', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:jensen-huang', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Mandarin', proficiency: 'conversational' }] },
  { personId: 'person:dara-khosrowshahi', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Farsi', proficiency: 'fluent' }] },
  { personId: 'person:patrick-collison', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Irish', proficiency: 'conversational' }] },
  { personId: 'person:john-collison', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:tobi-lutke', langs: [{ language: 'English', proficiency: 'fluent' }, { language: 'German', proficiency: 'native' }] },
  { personId: 'person:naval-ravikant', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Hindi', proficiency: 'conversational' }] },
  { personId: 'person:reid-hoffman', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:marc-andreessen', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:peter-thiel', langs: [{ language: 'English', proficiency: 'native' }, { language: 'German', proficiency: 'fluent' }] },
  { personId: 'person:elad-gil', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:garry-tan', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:sarah-guo', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Mandarin', proficiency: 'fluent' }] },
  { personId: 'person:vinod-khosla', langs: [{ language: 'English', proficiency: 'fluent' }, { language: 'Hindi', proficiency: 'native' }, { language: 'Punjabi', proficiency: 'native' }] },
  { personId: 'person:ann-miura-ko', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Japanese', proficiency: 'fluent' }] },
  { personId: 'person:rod-drury', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:peter-beck', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:vaughan-rowsell', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:craig-piggott', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:jamie-beaton', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Mandarin', proficiency: 'conversational' }] },
  { personId: 'person:nick-molnar', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:anthony-eisen', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:paul-bassat', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:jemma-green', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:matt-barrie', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:cameron-adams', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:cliff-obrecht', langs: [{ language: 'English', proficiency: 'native' }] },
  { personId: 'person:alexandr-wang', langs: [{ language: 'English', proficiency: 'native' }, { language: 'Mandarin', proficiency: 'conversational' }] },
];

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  const client = await pool.connect();
  const stats = { personsCreated: 0, personsUpdated: 0, nodesUpdated: 0, weCreated: 0, edCreated: 0, langCreated: 0 };

  try {
    if (!DRY_RUN) await client.query('BEGIN');

    console.log(`\n${ DRY_RUN ? '🔍 DRY RUN' : '🚀 EXECUTING' } — Database Record Completion\n`);

    // ── 1. Create missing Person records for AU ecosystem ──────────────────
    console.log('═══ Creating missing Person records ═══');
    for (const [id, data] of Object.entries(auMissingPersons)) {
      // Check node exists
      const { rows } = await client.query('SELECT id FROM nodes WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Node ${id} not found, skipping`); continue; }
      // Check person doesn't exist
      const { rows: existing } = await client.query('SELECT id FROM persons WHERE id = $1', [id]);
      if (existing.length > 0) { console.log(`  ✓ Person ${id} already exists`); continue; }

      console.log(`  + ${id} — ${data.name}`);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO persons (id, name, subtitle, bio, location, website, linkedin_url, twitter_url, phone, pronouns, open_to_work, tags, metadata, has_onboarded, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, '{}', false, NOW())`,
          [id, data.name, data.subtitle, data.bio, data.location, data.website, data.linkedinUrl, data.twitterUrl ?? null, data.phone, data.pronouns, data.tags]
        );
      }
      stats.personsCreated++;
    }

    // ── 2. Create Person records for SF Founders ──────────────────────────
    console.log('\n═══ Creating Person records for SF Founders ═══');
    for (const [id, data] of Object.entries(sfFounderPersons)) {
      const { rows: existing } = await client.query('SELECT id FROM persons WHERE id = $1', [id]);
      if (existing.length > 0) { console.log(`  ✓ Person ${id} already exists`); continue; }

      console.log(`  + ${id} — ${data.name}`);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO persons (id, name, subtitle, bio, location, website, linkedin_url, twitter_url, phone, pronouns, open_to_work, tags, metadata, has_onboarded, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, '{}', false, NOW())`,
          [id, data.name, data.subtitle, data.bio, data.location, data.website, data.linkedinUrl, data.twitterUrl ?? null, data.phone, data.pronouns, data.tags]
        );
      }
      stats.personsCreated++;
    }

    // ── 3. Update existing Persons with missing fields (SF) ───────────────
    console.log('\n═══ Updating SF Person profiles ═══');
    for (const [id, data] of Object.entries(sfPersonCompletions)) {
      const { rows } = await client.query('SELECT id, bio, website, linkedin_url, twitter_url, phone, pronouns FROM persons WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${id} not found`); continue; }
      const p = rows[0];
      const updates = [];
      const vals = [];
      let idx = 1;
      if (!p.bio && data.bio) { updates.push(`bio = $${idx++}`); vals.push(data.bio); }
      if (!p.website && data.website) { updates.push(`website = $${idx++}`); vals.push(data.website); }
      if (!p.linkedin_url && data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); vals.push(data.linkedinUrl); }
      if (!p.twitter_url && data.twitterUrl) { updates.push(`twitter_url = $${idx++}`); vals.push(data.twitterUrl); }
      if (!p.phone && data.phone) { updates.push(`phone = $${idx++}`); vals.push(data.phone); }
      if (!p.pronouns && data.pronouns) { updates.push(`pronouns = $${idx++}`); vals.push(data.pronouns); }
      if (updates.length === 0) { continue; }
      updates.push(`updated_at = NOW()`);
      console.log(`  ~ ${id} — updating ${updates.length - 1} fields`);
      if (!DRY_RUN) {
        vals.push(id);
        await client.query(`UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
      }
      stats.personsUpdated++;
    }

    // ── 4. Update existing Persons with missing fields (NZ) ───────────────
    console.log('\n═══ Updating NZ Person profiles ═══');
    for (const [id, data] of Object.entries(nzPersonCompletions)) {
      const { rows } = await client.query('SELECT id, bio, website, linkedin_url, twitter_url, phone, pronouns FROM persons WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${id} not found`); continue; }
      const p = rows[0];
      const updates = [];
      const vals = [];
      let idx = 1;
      if (!p.bio && data.bio) { updates.push(`bio = $${idx++}`); vals.push(data.bio); }
      if (!p.website && data.website) { updates.push(`website = $${idx++}`); vals.push(data.website); }
      if (!p.linkedin_url && data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); vals.push(data.linkedinUrl); }
      if (!p.twitter_url && data.twitterUrl) { updates.push(`twitter_url = $${idx++}`); vals.push(data.twitterUrl); }
      if (!p.phone && data.phone) { updates.push(`phone = $${idx++}`); vals.push(data.phone); }
      if (!p.pronouns && data.pronouns) { updates.push(`pronouns = $${idx++}`); vals.push(data.pronouns); }
      if (updates.length === 0) { continue; }
      updates.push(`updated_at = NOW()`);
      console.log(`  ~ ${id} — updating ${updates.length - 1} fields`);
      if (!DRY_RUN) {
        vals.push(id);
        await client.query(`UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
      }
      stats.personsUpdated++;
    }

    // ── 5. Update SF additional person completions ────────────────────────
    console.log('\n═══ Updating SF additional Person profiles ═══');
    for (const [id, data] of Object.entries(sfAdditionalCompletions)) {
      const { rows } = await client.query('SELECT id, bio, location, website, linkedin_url, twitter_url, phone, pronouns, tags FROM persons WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${id} not found`); continue; }
      const p = rows[0];
      const updates = [];
      const vals = [];
      let idx = 1;
      if (!p.bio && data.bio) { updates.push(`bio = $${idx++}`); vals.push(data.bio); }
      if (!p.location && data.location) { updates.push(`location = $${idx++}`); vals.push(data.location); }
      if (!p.website && data.website) { updates.push(`website = $${idx++}`); vals.push(data.website); }
      if (!p.linkedin_url && data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); vals.push(data.linkedinUrl); }
      if (!p.twitter_url && data.twitterUrl) { updates.push(`twitter_url = $${idx++}`); vals.push(data.twitterUrl); }
      if (!p.phone && data.phone) { updates.push(`phone = $${idx++}`); vals.push(data.phone); }
      if (!p.pronouns && data.pronouns) { updates.push(`pronouns = $${idx++}`); vals.push(data.pronouns); }
      if ((!p.tags || p.tags.length === 0) && data.tags) { updates.push(`tags = $${idx++}`); vals.push(data.tags); }
      if (updates.length === 0) { continue; }
      updates.push(`updated_at = NOW()`);
      console.log(`  ~ ${id} — updating ${updates.length - 1} fields`);
      if (!DRY_RUN) {
        vals.push(id);
        await client.query(`UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
      }
      stats.personsUpdated++;
    }

    // ── 6. Update Blackbird community persons ─────────────────────────────
    console.log('\n═══ Updating Blackbird Ventures Person profiles ═══');
    for (const [id, data] of Object.entries(blackbirdCompletions)) {
      const { rows } = await client.query('SELECT id, bio, subtitle, location, linkedin_url, tags FROM persons WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${id} not found`); continue; }
      const p = rows[0];
      const updates = [];
      const vals = [];
      let idx = 1;
      if (!p.bio && data.bio) { updates.push(`bio = $${idx++}`); vals.push(data.bio); }
      if (!p.subtitle && data.subtitle) { updates.push(`subtitle = $${idx++}`); vals.push(data.subtitle); }
      if (!p.location && data.location) { updates.push(`location = $${idx++}`); vals.push(data.location); }
      if (!p.linkedin_url && data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); vals.push(data.linkedinUrl); }
      if ((!p.tags || p.tags.length === 0) && data.tags) { updates.push(`tags = $${idx++}`); vals.push(data.tags); }
      if (updates.length === 0) { continue; }
      updates.push(`updated_at = NOW()`);
      console.log(`  ~ ${id} — updating ${updates.length - 1} fields`);
      if (!DRY_RUN) {
        vals.push(id);
        await client.query(`UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
      }
      stats.personsUpdated++;

      // Also update the node record
      const nodeUpdates = [];
      const nodeVals = [];
      let nIdx = 1;
      const { rows: nodeRows } = await client.query('SELECT subtitle, location, tags FROM nodes WHERE id = $1', [id]);
      if (nodeRows.length > 0) {
        const n = nodeRows[0];
        if ((!n.subtitle || n.subtitle === '') && data.subtitle) { nodeUpdates.push(`subtitle = $${nIdx++}`); nodeVals.push(data.subtitle); }
        if ((!n.location || n.location === '') && data.location) { nodeUpdates.push(`location = $${nIdx++}`); nodeVals.push(data.location); }
        if ((!n.tags || n.tags.length === 0) && data.tags) { nodeUpdates.push(`tags = $${nIdx++}`); nodeVals.push(data.tags); }
        if (nodeUpdates.length > 0) {
          nodeUpdates.push(`updated_at = NOW()`);
          nodeVals.push(id);
          if (!DRY_RUN) {
            await client.query(`UPDATE nodes SET ${nodeUpdates.join(', ')} WHERE id = $${nIdx}`, nodeVals);
          }
          stats.nodesUpdated++;
        }
      }
    }

    // ── 7. Update Icehouse Ventures persons ───────────────────────────────
    console.log('\n═══ Updating Icehouse Ventures Person profiles ═══');
    for (const [id, data] of Object.entries(icehouseCompletions)) {
      const { rows } = await client.query('SELECT id, bio, location, linkedin_url, tags FROM persons WHERE id = $1', [id]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${id} not found`); continue; }
      const p = rows[0];
      const updates = [];
      const vals = [];
      let idx = 1;
      if (!p.bio && data.bio) { updates.push(`bio = $${idx++}`); vals.push(data.bio); }
      if (!p.location && data.location) { updates.push(`location = $${idx++}`); vals.push(data.location); }
      if (!p.linkedin_url && data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); vals.push(data.linkedinUrl); }
      if ((!p.tags || p.tags.length === 0) && data.tags) { updates.push(`tags = $${idx++}`); vals.push(data.tags); }
      if (updates.length === 0) { continue; }
      updates.push(`updated_at = NOW()`);
      console.log(`  ~ ${id} — updating ${updates.length - 1} fields`);
      if (!DRY_RUN) {
        vals.push(id);
        await client.query(`UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
      }
      stats.personsUpdated++;

      // Update node too
      const nodeUpdates = [];
      const nodeVals = [];
      let nIdx = 1;
      const { rows: nodeRows } = await client.query('SELECT location, tags FROM nodes WHERE id = $1', [id]);
      if (nodeRows.length > 0) {
        const n = nodeRows[0];
        if ((!n.location || n.location === '') && data.location) { nodeUpdates.push(`location = $${nIdx++}`); nodeVals.push(data.location); }
        if ((!n.tags || n.tags.length === 0) && data.tags) { nodeUpdates.push(`tags = $${nIdx++}`); nodeVals.push(data.tags); }
        if (nodeUpdates.length > 0) {
          nodeUpdates.push(`updated_at = NOW()`);
          nodeVals.push(id);
          if (!DRY_RUN) {
            await client.query(`UPDATE nodes SET ${nodeUpdates.join(', ')} WHERE id = $${nIdx}`, nodeVals);
          }
          stats.nodesUpdated++;
        }
      }
    }

    // ── 8. Insert Work Experience ─────────────────────────────────────────
    console.log('\n═══ Creating Work Experience records ═══');
    for (const { personId, entries } of workExperienceData) {
      // Check person exists
      const { rows } = await client.query('SELECT id FROM persons WHERE id = $1', [personId]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${personId} not found`); continue; }
      // Check if already has work experience
      const { rows: existing } = await client.query('SELECT id FROM work_experience WHERE person_id = $1', [personId]);
      if (existing.length > 0) { continue; }

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        console.log(`  + ${personId} — ${e.title} at ${e.company}`);
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO work_experience (id, person_id, title, company, location, start_date, end_date, current, description, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [uuid(), personId, e.title, e.company, e.location ?? null, e.startDate, e.endDate ?? null, e.current ?? false, e.description ?? null, i]
          );
        }
        stats.weCreated++;
      }
    }

    // ── 9. Insert Education ───────────────────────────────────────────────
    console.log('\n═══ Creating Education records ═══');
    for (const { personId, entries } of educationData) {
      const { rows } = await client.query('SELECT id FROM persons WHERE id = $1', [personId]);
      if (rows.length === 0) { console.log(`  ⚠️  Person ${personId} not found`); continue; }
      const { rows: existing } = await client.query('SELECT id FROM education WHERE person_id = $1', [personId]);
      if (existing.length > 0) { continue; }

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        console.log(`  + ${personId} — ${e.degree ?? 'Study'} at ${e.school}`);
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO education (id, person_id, school, degree, field_of_study, start_year, end_year, description, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [uuid(), personId, e.school, e.degree ?? null, e.fieldOfStudy ?? null, e.startYear ?? null, e.endYear ?? null, e.description ?? null, i]
          );
        }
        stats.edCreated++;
      }
    }

    // ── 10. Insert Languages ──────────────────────────────────────────────
    console.log('\n═══ Creating Language records ═══');
    for (const { personId, langs } of languageData) {
      const { rows } = await client.query('SELECT id FROM persons WHERE id = $1', [personId]);
      if (rows.length === 0) { continue; }
      const { rows: existing } = await client.query('SELECT id FROM profile_languages WHERE person_id = $1', [personId]);
      if (existing.length > 0) { continue; }

      for (let i = 0; i < langs.length; i++) {
        const l = langs[i];
        console.log(`  + ${personId} — ${l.language} (${l.proficiency})`);
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO profile_languages (id, person_id, language, proficiency, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [uuid(), personId, l.language, l.proficiency, i]
          );
        }
        stats.langCreated++;
      }
    }

    // ── 11. Update Node aliases for SF ecosystem ──────────────────────────
    console.log('\n═══ Setting node aliases ═══');
    const aliasMap = {
      // SF founders
      'founder:aaron-levie': 'Founder', 'founder:alexis-ohanian': 'Founder',
      'founder:brian-chesky': 'Founder', 'founder:brian-armstrong': 'Founder',
      'founder:ben-silbermann': 'Founder', 'founder:biz-stone': 'Founder',
      'founder:bastian-lehmann': 'Founder',
      // SF people
      'person:sam-altman': 'Founder', 'person:jensen-huang': 'Founder',
      'person:dara-khosrowshahi': 'CEO', 'person:patrick-collison': 'Founder',
      'person:john-collison': 'Founder', 'person:tobi-lutke': 'Founder',
      'person:naval-ravikant': 'Investor', 'person:reid-hoffman': 'Investor',
      'person:marc-andreessen': 'Investor', 'person:peter-thiel': 'Investor',
      'person:elad-gil': 'Investor', 'person:garry-tan': 'Ecosystem Leader',
      'person:sarah-guo': 'Investor', 'person:vinod-khosla': 'Investor',
      'person:ann-miura-ko': 'Investor',
      'person:aaron-patzer': 'Founder', 'person:alexandr-wang': 'Founder',
      'person:apoorva-mehta': 'Founder',
    };
    for (const [id, alias] of Object.entries(aliasMap)) {
      const { rows } = await client.query('SELECT alias FROM nodes WHERE id = $1', [id]);
      if (rows.length === 0) continue;
      if (rows[0].alias) continue; // already set
      console.log(`  ~ ${id} — alias: ${alias}`);
      if (!DRY_RUN) {
        await client.query('UPDATE nodes SET alias = $1, updated_at = NOW() WHERE id = $2', [alias, id]);
      }
      stats.nodesUpdated++;
    }

    if (!DRY_RUN) await client.query('COMMIT');

    // ── Summary ──────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log(`📊 ${DRY_RUN ? 'DRY RUN' : 'EXECUTION'} SUMMARY`);
    console.log(`   Persons created:       ${stats.personsCreated}`);
    console.log(`   Persons updated:       ${stats.personsUpdated}`);
    console.log(`   Nodes updated:         ${stats.nodesUpdated}`);
    console.log(`   Work Experience added:  ${stats.weCreated}`);
    console.log(`   Education added:        ${stats.edCreated}`);
    console.log(`   Languages added:        ${stats.langCreated}`);
    console.log('═══════════════════════════════════════════\n');

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
