import type { GuidelinesCopy, LegalCopy } from "@/lib/legal";
import { CONTACT_EMAIL } from "@/lib/site-config";

export const PRIVACY_COPY: LegalCopy = {
  title: "隐私政策",
  updated: "最后更新：2026 年 7 月",
  blocks: [
    {
      heading: "概述",
      paragraphs: [
        "本应用为个人独立开发的网络应用，用于管理新加坡国立大学（NUS）尤索夫楼（Eusoff Hall）乐队排练室的后勤事务。它不是 Eusoff Hall 或新加坡国立大学的官方平台。",
      ],
    },
    {
      heading: "我们收集的信息",
      paragraphs: ["我们仅收集运营服务所必需的信息："],
      bullets: [
        { label: "提交数据", text: "提交房间申请时提供的活动名称和姓名" },
        { label: "使用数据", text: "通过 Vercel Analytics 收集的匿名、汇总的页面浏览统计信息。其中不包含任何个人信息，不设置 Cookie，也不进行跨站追踪。" },
        { label: "性能数据", text: "通过 Vercel Speed Insights 收集的匿名加载速度和响应性能指标（Web Vitals），用于监测和改进服务。该数据不包含任何个人信息，不设置 Cookie，也不进行跨站追踪。" },
      ],
    },
    {
      heading: "信息用途",
      paragraphs: [
        "提交数据用于处理和管理乐队排练室申请。为协调共享日程，已获批准申请的详情（其活动名称及所提供的姓名）会被发送至供乐队管理员和成员使用的私密 Telegram 群组。使用数据和性能数据仅用于了解整体流量模式、监测页面加载速度并改进服务。两者均不会用于营销或用户画像。",
      ],
    },
    {
      heading: "数据存储与处理",
      paragraphs: [
        "本应用使用第三方基础设施安全地存储和处理数据。使用本服务即表示您认可数据将根据以下各方的条款进行处理：",
      ],
      bullets: [
        { label: "Supabase", text: "数据库及身份验证基础设施。隐私政策与条款", href: "https://supabase.com/privacy" },
        { label: "Vercel", text: "托管与分析服务。隐私政策与条款", href: "https://vercel.com/legal/privacy-policy" },
        { label: "Telegram", text: "即时通讯平台。当申请获批时，其活动名称及所提供的姓名会被发送至供乐队管理员和成员协调日程使用的私密 Telegram 群组。隐私政策", href: "https://telegram.org/privacy" },
      ],
    },
    {
      heading: "第三方链接",
      paragraphs: [
        "本网站可能包含指向 Eusoff Bandits Instagram 页面的链接。一旦您离开本应用，将适用目标平台的隐私政策。我们对外部网站的内容或数据处理方式不承担责任。",
      ],
    },
    {
      heading: "数据保留",
      paragraphs: [
        "提交数据将出于管理目的予以保留，并定期进行审查。目前没有自动删除计划。您可以随时要求删除数据。",
      ],
    },
    {
      heading: "您的权利",
      paragraphs: [
        `如需访问、更正或删除与您的提交相关的数据，请联系：${CONTACT_EMAIL}。我们将在合理时间内对合理请求作出回应。`,
      ],
    },
    {
      heading: "免责声明",
      paragraphs: [
        "本应用按“原样”提供，供 Eusoff Hall 社区内部使用。它未经正式注册，不涉及商业运营，亦不与任何机构存在隶属关系。对于服务的运行时间、数据保留或服务连续性，我们不作任何保证。",
      ],
    },
  ],
};

export const TERMS_COPY: LegalCopy = {
  title: "使用条款",
  updated: "最后更新：2026 年 7 月",
  blocks: [
    {
      heading: "概述",
      paragraphs: [
        "继续使用本应用即表示您同意以下条款。如果您不同意，请勿使用本服务。",
      ],
    },
    {
      heading: "使用资格与访问权限",
      paragraphs: [
        "本应用仅供 Eusoff Hall 住户及乐队成员使用。访问权限由管理员全权决定，并可随时修改或撤销，恕不另行通知。用户无权要求持续获得访问权限。",
      ],
    },
    {
      heading: "房间预订",
      paragraphs: [
        "通过本应用提交的所有房间申请均需经管理员审核批准。提交申请并不构成预订确认。管理员保留拒绝、修改或取消任何申请的权利，且无需说明理由。",
        "多次滥用预订系统，包括但不限于提交垃圾信息、提供虚假信息或扰乱秩序的行为，可能导致访问权限被永久取消。",
      ],
    },
    {
      heading: "免责声明",
      paragraphs: ["本应用按“原样”提供，不附带任何形式的保证。对于以下事项，我们不作任何保证："],
      bullets: [
        { text: "服务的正常运行时间或可用性" },
        { text: "预订信息的准确性或完整性" },
        { text: "已提交数据的保存" },
        { text: "服务的连续性" },
      ],
    },
    {
      heading: "责任限制",
      paragraphs: ["本应用的开发者对以下情况不承担任何责任："],
      bullets: [
        { text: "预订遗漏或日程冲突" },
        { text: "数据或已提交信息的丢失" },
        { text: "服务中断或停机" },
        { text: "因使用本应用而产生的任何间接或后果性损失" },
      ],
      links: [],
    },
    {
      heading: "自行承担风险",
      paragraphs: ["使用本服务完全由您自行承担风险。"],
    },
    {
      heading: "数据分析",
      paragraphs: [
        "使用本应用即表示您知悉，系统将通过 Vercel Analytics 收集匿名、汇总的页面浏览数据，并通过 Vercel Speed Insights 收集匿名的性能指标（Web Vitals）。该数据不包含任何个人信息。",
      ],
      links: [{ label: "Vercel 隐私政策", href: "https://vercel.com/legal/privacy-policy" }],
    },
    {
      heading: "知识产权",
      paragraphs: [
        "本应用为独立的个人项目。它与 Eusoff Hall、新加坡国立大学（NUS）或任何其他机构均无隶属关系，亦未获得其认可或代表其开发。应用程序代码及设计的所有权利归开发者所有。",
      ],
    },
    {
      heading: "条款变更",
      paragraphs: [
        "本条款可能随时更新。更新后继续使用本应用即视为接受修订后的条款。本文档顶部的“最后更新”日期将反映所有变更。",
      ],
    },
    {
      heading: "联系方式",
      paragraphs: [`如有疑问、顾虑或数据请求，请联系：${CONTACT_EMAIL}`],
    },
  ],
};

export const BOOKING_GUIDELINES_COPY: GuidelinesCopy = {
  title: "乐队排练室使用须知",
  intro: "预约前请注意以下事项。",
  blocks: [
    {
      heading: "入场",
      paragraphs: ["如果您需要协助开门或布置场地，请向其中一位乐队协调员发送短信。"],
    },
    {
      heading: "排练期间",
      paragraphs: [
        "排练期间必须有乐队成员在场。请小心使用所有乐器和设备。这些是共享资源，请务必爱护。",
      ],
    },
    {
      heading: "开机顺序",
      paragraphs: ["请按以下顺序操作：1. 打开调音台；2. 打开监听音箱和主音箱；3. 打开功放。注意：开始演奏前请将音量调至较低。"],
    },
    {
      heading: "关机顺序",
      paragraphs: [
        "请按相反顺序操作：1. 调低音量；2. 关闭功放；3. 关闭主音箱和监听音箱；4. 关闭调音台。",
        "重要提示：离开前请关闭电源和灯光。错误的开关顺序会导致系统发出刺耳的爆音，并可能随着时间推移损坏音箱，因此这一点非常重要。",
      ],
    },
    {
      heading: "离场前检查",
      bullets: [
        { text: "将所有线缆整齐盘绕，放回原位。" },
        { text: "将乐器放回支架上，切勿靠墙放置。" },
        { text: "若移动过鼓组，请将其恢复至原位。" },
        { text: "乐队排练室禁止饮食，允许携带密封饮料。" },
      ],
    },
    {
      heading: "需要帮助？",
      paragraphs: ["请通过以下的联系方式与我们联系。"],
    },
  ],
};