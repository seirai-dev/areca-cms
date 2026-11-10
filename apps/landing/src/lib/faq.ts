import { m } from '@/paraglide/messages'

// The questions in the FAQ section. The section and the FAQPage structured
// data both read this list, so the two can never drift apart.
export const faq = [
  { question: m.faq_q1, answer: m.faq_a1 },
  { question: m.faq_q2, answer: m.faq_a2 },
  { question: m.faq_q3, answer: m.faq_a3 },
  { question: m.faq_q4, answer: m.faq_a4 },
  { question: m.faq_q5, answer: m.faq_a5 },
  { question: m.faq_q6, answer: m.faq_a6 },
] as const
