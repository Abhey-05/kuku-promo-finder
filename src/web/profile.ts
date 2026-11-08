/**
 * The About Me page. Everything here comes from the builder's resume text, except the links.
 * A value of FILL_ME shows as a visible placeholder instead of a broken link.
 */
export const FILL_ME = 'FILL_ME';

export const PROFILE = {
  name: 'Abhey Garg',
  line: 'B.Tech Electrical Engineering (IC Design and Technology), IIT Hyderabad, 2023–2027. Roll EE23BTECH11202.',
  bio: [
    'Electrical Engineering student at IIT Hyderabad, specialising in IC Design and Technology.',
    'At InventX 2025, IIT Gandhinagar, designed and prototyped a smart assistive bed; provisional patents were filed in India and the USA, and it won the Third Best Invention Award.',
    'Also works on data and product problems: SQL analytics, market research, and leading corporate outreach at Tinkerers’ Lab.',
  ],
  links: {
    linkedin: FILL_ME,
    github: 'https://github.com/Abhey-05',
    email: FILL_ME,
    resume: 'resume.pdf',
  },
  experience: [
    {
      title: 'InventX 2025, IIT Gandhinagar',
      when: 'May 2025 – July 2025',
      points: [
        'Designed and prototyped a smart assistive bed for safer and easier patient transitions.',
        'Provisional patents filed in India and the USA, fully sponsored by IIT Gandhinagar.',
        'Third Best Invention Award for technological and societal impact.',
      ],
    },
    {
      title: 'Head, Corporate Networking and Growth, Tinkerers’ Lab, IIT Hyderabad',
      when: 'April 2025 – present',
      points: ['Secured ₹7.5L sponsorship in 3 months by leading corporate outreach.', 'Earlier, as Core, raised ₹10L sponsorship, 40% of the event budget for the institute’s tech fest.'],
    },
    {
      title: 'Core, Internship Cell, Office of Career Services, IIT Hyderabad',
      when: 'April 2025 – present',
      points: ['Helps run internship drives and coordinate with companies.'],
    },
  ],
  projects: [
    {
      title: 'Solving Inventory Inefficiencies Using Advanced SQL Analytics',
      when: 'Self project, July 2025',
      text: 'A normalised SQL database and more than 15 advanced queries to find stockouts, overstocking and forecasting errors, with KPI dashboards for revenue leakage.',
    },
    {
      title: 'Building a Digital Mental Health Platform for Underserved Populations',
      when: 'E Cell, IIT Guwahati, June 2025',
      text: 'A multilingual, low-data PWA concept with AI screening, offline CBT tools, peer forums and tele-counselling, priced at ₹50 to 250 a month.',
    },
    {
      title: 'Boosting Revenue in Urban Food Courts',
      when: 'Finance and Consulting Club, IIT Hyderabad, May 2025',
      text: 'Analysed post-COVID footfall data and proposed QR ordering, curated menus and a seating redesign to lift food court conversion.',
    },
  ],
  skills: [
    ['Technical', 'SQL, C++, C, Python, HTML, CSS, Matlab, Verilog'],
    ['Business tools', 'Excel, PowerPoint, Power BI, Tableau, Notion'],
    ['Core', 'Market research, project management, data-driven decisions, stakeholder engagement'],
  ] as [string, string][],
  why: [
    ['Heuristic first', 'Rules score every possible cut in under a second, for free. That is what makes a 50-episode show, or a thousand shows, cheap to process.'],
    ['An LLM agent for judgement', 'A model judges only the best 30, re-cuts the top 15 using entry IDs, and writes the hook and why lines. Any provider can be plugged in.'],
    ['A verifier so nothing is invented', 'Code checks every model output: known IDs only, quotes copied exactly from the script, 20 to 60 seconds, no overlaps. Failures retry once, then fall back.'],
  ] as [string, string][],
};
