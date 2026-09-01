import type { GuidelinesCopy, LegalCopy } from "@/lib/legal";
import { CONTACT_EMAIL } from "@/lib/site-config";

export const PRIVACY_COPY: LegalCopy = {
  title: "Privacy Policy",
  updated: "Last updated: July 2026",
  blocks: [
    {
      heading: "Overview",
      paragraphs: [
        "This is a personal, independently developed web application for managing band room logistics at Eusoff Hall, NUS. It is not an official platform of Eusoff Hall or the National University of Singapore.",
      ],
    },
    {
      heading: "Information We Collect",
      paragraphs: ["We collect only what is necessary to operate the service:"],
      bullets: [
        { label: "Submission data", text: "the session title and name you provide when submitting a room request" },
        { label: "Usage data", text: "anonymous, aggregated page view statistics collected via Vercel Analytics. No personal information is included, no cookies are set, and no cross-site tracking occurs." },
        { label: "Performance data", text: "anonymous load-speed and responsiveness metrics (Web Vitals) collected via Vercel Speed Insights on every visit, including before consent, to monitor and improve the service. No personal information is included, no cookies are set, and no cross-site tracking occurs." },
      ],
    },
    {
      heading: "How We Use It",
      paragraphs: [
        "Submission data is used to process and manage band room requests. To coordinate the shared schedule, the details of an approved booking — its session title and the name provided — are sent to a private Telegram group used by band administrators and members. Usage and performance data are used only to understand general traffic patterns, monitor page load speed, and improve the service. None of it is used for marketing or profiling.",
      ],
    },
    {
      heading: "Data Storage and Processing",
      paragraphs: [
        "This application uses third-party infrastructure to store and process data securely. By using this service, you acknowledge that data may be processed in accordance with their respective terms:",
      ],
      bullets: [
        { label: "Supabase", text: "database and authentication infrastructure. Privacy Policy & Terms", href: "https://supabase.com/privacy" },
        { label: "Vercel", text: "hosting and analytics. Privacy Policy & Terms", href: "https://vercel.com/legal/privacy-policy" },
        { label: "Telegram", text: "messaging platform. When a booking is approved, its session title and the name provided are sent to a private Telegram group used by band administrators and members to coordinate the schedule. Privacy Policy", href: "https://telegram.org/privacy" },
      ],
    },
    {
      heading: "Third Party Links",
      paragraphs: [
        "This site may link to the Eusoff Bandits Instagram page. Once you leave this application, the privacy practices of the destination platform apply. We are not responsible for external content or data practices.",
      ],
    },
    {
      heading: "Data Retention",
      paragraphs: [
        "Submission data is retained for administrative purposes and reviewed periodically. There is no automated deletion schedule. You may request deletion at any time.",
      ],
    },
    {
      heading: "Your Rights",
      paragraphs: [
        `To request access to, correction of, or deletion of any data associated with your submission, contact ${CONTACT_EMAIL}. We will respond to reasonable requests within a reasonable timeframe.`,
      ],
    },
    {
      heading: "Disclaimer",
      paragraphs: [
        "This application is provided as-is for community use within Eusoff Hall. It is not formally registered, commercially operated, or affiliated with any institution. No guarantees are made regarding uptime, data retention, or service continuity.",
      ],
    },
  ],
};

export const TERMS_COPY: LegalCopy = {
  title: "Terms of Use",
  updated: "Last updated: July 2026",
  blocks: [
    {
      heading: "Overview",
      paragraphs: [
        "By continuing to use this application, you agree to the following terms. If you do not agree, please do not use the service.",
      ],
    },
    {
      heading: "Eligibility and Access",
      paragraphs: [
        "This application is intended for use by Eusoff Hall residents and band members. Access is provided at the sole discretion of the administrator and may be modified or revoked at any time without notice. There is no entitlement to continued access.",
      ],
    },
    {
      heading: "Room Bookings",
      paragraphs: [
        "All room requests submitted through this application are subject to review and approval by an administrator. Submitting a request does not constitute a confirmed booking. The administrator reserves the right to decline, modify, or cancel any request without obligation to provide a reason.",
        "Repeated misuse of the booking system, including but not limited to spam submissions, false information, or disruptive behaviour, may result in permanent removal of access.",
      ],
    },
    {
      heading: "No Guarantees",
      paragraphs: ["This application is provided as-is, without warranties of any kind. No guarantees are made regarding:"],
      bullets: [
        { text: "Uptime or availability of the service" },
        { text: "Accuracy or completeness of booking information" },
        { text: "Preservation of submitted data" },
        { text: "Continuity of the service" },
      ],
    },
    {
      heading: "Limitation of Liability",
      paragraphs: ["The developer of this application accepts no liability for:"],
      bullets: [
        { text: "Missed bookings or scheduling conflicts" },
        { text: "Loss of data or submitted information" },
        { text: "Service interruptions or downtime" },
        { text: "Any indirect or consequential loss arising from use of the application" },
      ],
      links: [],
    },
    {
      heading: "Use At Your Own Risk",
      paragraphs: ["Use of this service is entirely at your own risk."],
    },
    {
      heading: "Analytics",
      paragraphs: [
        "By using this application you acknowledge that anonymous, aggregated page view data is collected via Vercel Analytics, and anonymous performance metrics (Web Vitals) are collected via Vercel Speed Insights. No personal information is included in this data.",
      ],
      links: [{ label: "Vercel Privacy Policy", href: "https://vercel.com/legal/privacy-policy" }],
    },
    {
      heading: "Intellectual Property",
      paragraphs: [
        "This application is an independent personal project. It is not affiliated with, endorsed by, or developed on behalf of Eusoff Hall, NUS, or any other institution. All rights to the application code and design are retained by the developer.",
      ],
    },
    {
      heading: "Changes to These Terms",
      paragraphs: [
        "These terms may be updated at any time. Continued use of the application following any update constitutes acceptance of the revised terms. The Last updated date at the top of this document will reflect any changes.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: [`For questions, concerns, or data requests: ${CONTACT_EMAIL}`],
    },
  ],
};

export const BOOKING_GUIDELINES_COPY: GuidelinesCopy = {
  title: "Band Room Guidelines",
  intro: "Before you book, a few things to note.",
  blocks: [
    {
      heading: "Getting in",
      paragraphs: ["If you need help opening up or getting set up, just text one of the band leaders."],
    },
    {
      heading: "During your session",
      paragraphs: [
        "A band member should be present for the full duration of the session. Handle all instruments and gear with care. They're shared, so be mindful.",
      ],
    },
    {
      heading: "Turning on",
      paragraphs: ["Follow this order: mixer first, then monitors and speakers, then amps. Start with levels low before playing."],
    },
    {
      heading: "Turning off",
      paragraphs: [
        "Reverse the order: bring levels down, turn off amps first, then speakers and monitors, then the mixer last. AC and lights off before you leave.",
        "Getting the order wrong can send a loud pop through the system and damage the speakers over time, so it matters.",
      ],
    },
    {
      heading: "Before you leave",
      bullets: [
        { text: "Coil all cables properly and return them to where you found them" },
        { text: "Return instruments to their stands, not leaning against walls" },
        { text: "Put the drum kit back to its original position if you adjusted it" },
        { text: "No food in the band room; sealed drinks are fine" },
      ],
    },
    {
      heading: "Need help?",
      paragraphs: ["Reach out through any of the contacts listed below :)"],
    },
  ],
};
