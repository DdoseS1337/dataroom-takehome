import type { PdfDocument } from './pdf';

/**
 * What the demo data room contains.
 *
 * Kept apart from `seed.ts` so that file stays about *how* the tree is written — through the
 * same services the browser drives — rather than about what is in it. The documents are
 * fiction, and deliberately obviously so: a demo data room full of plausible-looking real
 * company filings would be a worse thing to hand a reviewer than one about Project Atlas.
 *
 * The shape is three levels below each room's root, which is what exercises breadcrumbs,
 * the trimmed trail a share recipient sees, and the depth-shifting half of a move.
 */

export interface SeedFile {
  name: string;
  document: PdfDocument;
}

export interface SeedFolder {
  name: string;
  folders?: SeedFolder[];
  files?: SeedFile[];
}

export interface SeedRoom {
  name: string;
  folders: SeedFolder[];
}

/**
 * Where the seeded public link is made. A folder rather than a file, so the recipient has
 * somewhere to navigate: a nested folder, a document, and a breadcrumb trail trimmed to
 * the top of what they are allowed to see.
 *
 * A top-level folder of a room, named by the two things that identify it. Not a path — the
 * seed matches this at one level, and a shape that looked like it walked deeper would be a
 * promise it does not keep.
 */
export const SHARED_FOLDER = {
  room: 'Project Atlas',
  folder: '02 Financial',
};

const CERTIFICATE: PdfDocument = {
  title: 'Certificate of Incorporation',
  reference: 'Atlas Components Limited | Company No. 08421990',
  sections: [
    {
      heading: 'Certificate',
      paragraphs: [
        'This is to certify that ATLAS COMPONENTS LIMITED is this day incorporated as a private company limited by shares, and that the company is registered in England and Wales.',
        'Given under the seal of the Registrar of Companies on 14 February 2013.',
      ],
    },
    {
      heading: 'Registered particulars',
      paragraphs: [
        'Registered office: Unit 7, Marlow Industrial Park, Reading, RG1 4QT. The registered office has not changed since incorporation.',
        'Principal activity: manufacture of precision components for industrial automation, SIC 28990.',
        'Accounting reference date: 31 March. The first accounting period ran from incorporation to 31 March 2014.',
      ],
    },
    {
      heading: 'Share capital on incorporation',
      paragraphs: [
        'The company was incorporated with an issued share capital of 100 ordinary shares of GBP 1.00 each, all of which were subscribed for in cash and fully paid.',
        'Subsequent allotments, the 2018 subdivision and the creation of the A ordinary class are recorded in the statutory registers and summarised in the capitalisation table provided separately.',
      ],
    },
    {
      heading: 'Note for the data room',
      paragraphs: [
        'This document is a specimen prepared for a demonstration data room. It records no real company and confers no rights.',
      ],
    },
  ],
};

const BOARD_MINUTES: PdfDocument = {
  title: 'Minutes of a Meeting of the Board of Directors',
  reference: 'Atlas Components Limited | 12 March 2026',
  sections: [
    {
      heading: 'Present and quorum',
      paragraphs: [
        'Present: J. Okonjo (Chair), R. Vance, S. Lindqvist, and M. Haddad. In attendance: T. Reyes, company secretary, and, for items 3 and 4 only, counsel from Fenwick Row LLP.',
        'The Chair noted that a quorum was present and declared the meeting open at 09:30. No director declared an interest in any matter on the agenda beyond those already entered in the register of interests.',
      ],
    },
    {
      heading: '1. Minutes of the previous meeting',
      paragraphs: [
        'The minutes of the meeting held on 6 February 2026 were approved as an accurate record and signed by the Chair.',
      ],
    },
    {
      heading: '2. Trading update',
      paragraphs: [
        'The board reviewed management accounts to 28 February 2026. Revenue for the eleven months was 6.1 per cent ahead of the same period in the prior year, with the shortfall against budget confined to the aftermarket division.',
        'The board noted that the two largest customers together accounted for 31 per cent of revenue in the period, and asked management to bring a concentration analysis to the next meeting.',
      ],
    },
    {
      heading: '3. Project Atlas',
      paragraphs: [
        'The Chair reported that a non-binding indicative offer had been received from Northgate Industrial Holdings plc for the entire issued share capital of the company, subject to due diligence and to agreement of a share purchase agreement.',
        'Counsel described the proposed structure and the principal conditions. The board discussed the exclusivity period requested and resolved to grant it for eight weeks from the date of the heads of terms, with no automatic extension.',
        'IT WAS RESOLVED that management be authorised to open a data room and to disclose to the proposed purchaser and its advisers such information as is reasonably required for due diligence, subject in each case to the confidentiality agreement dated 2 March 2026.',
      ],
    },
    {
      heading: '4. Disclosure and warranties',
      paragraphs: [
        'The board considered the draft disclosure letter. It was agreed that each disclosure would be tied to a document in the data room and that no general disclosure of the whole data room would be accepted.',
      ],
    },
    {
      heading: '5. Any other business and close',
      paragraphs: [
        'There being no other business, the Chair closed the meeting at 11:05. The next meeting is scheduled for 9 April 2026.',
      ],
    },
  ],
};

const SHARE_PURCHASE_AGREEMENT: PdfDocument = {
  title: 'Share Purchase Agreement',
  reference: 'Project Atlas | Draft 4 | 28 May 2026 | Subject to contract',
  sections: [
    {
      heading: 'Parties',
      paragraphs: [
        '(1) The persons whose names and addresses are set out in Schedule 1 (the Sellers); and (2) Northgate Industrial Holdings plc, a company incorporated in England and Wales with company number 04117362 (the Buyer).',
      ],
    },
    {
      heading: 'Background',
      paragraphs: [
        'The Sellers are together the legal and beneficial owners of the entire issued share capital of Atlas Components Limited (the Company). The Sellers have agreed to sell and the Buyer has agreed to buy the Shares on the terms of this agreement.',
      ],
    },
    {
      heading: '1. Interpretation',
      paragraphs: [
        'In this agreement the following definitions apply. Completion means completion of the sale and purchase of the Shares in accordance with clause 5. Completion Date means the date on which Completion takes place. Disclosed means fairly disclosed in the Disclosure Letter with sufficient detail to enable the Buyer to identify the nature and scope of the matter disclosed.',
        'Clause and Schedule headings do not affect interpretation. A reference to a document is a reference to that document as varied or novated from time to time. Where the words include or including are used they are taken to be followed by the words without limitation.',
      ],
    },
    {
      heading: '2. Sale and purchase',
      paragraphs: [
        'On the terms of this agreement, each Seller sells with full title guarantee, and the Buyer buys, the number of Shares set out opposite that Seller name in Schedule 1, free from all encumbrances and together with all rights attaching to them at Completion.',
        'Each Seller waives any right of pre-emption or other restriction on transfer conferred on it in respect of any of the Shares, whether under the articles of association of the Company or otherwise.',
        'The Buyer is not obliged to complete the purchase of any of the Shares unless the purchase of all of the Shares is completed simultaneously.',
      ],
    },
    {
      heading: '3. Consideration',
      paragraphs: [
        'The consideration for the sale of the Shares is the aggregate of the Initial Consideration and the Deferred Consideration, apportioned between the Sellers in the proportions set out in Schedule 1.',
        'The Initial Consideration is payable in cash at Completion by electronic transfer to the Sellers solicitors, whose receipt is a full discharge of the Buyer obligation to pay it, and the Buyer is not concerned to see to its application.',
        'The Deferred Consideration is determined by reference to the Completion Accounts and is payable within ten business days of those accounts becoming final and binding in accordance with Schedule 4.',
      ],
    },
    {
      heading: '4. Conditions',
      paragraphs: [
        'Completion is conditional on each of the conditions in Schedule 2 having been satisfied or waived by the Buyer. The Buyer may waive any condition in whole or in part at any time by written notice to the Sellers.',
        'Each party must use all reasonable endeavours to procure that the conditions are satisfied as soon as practicable and in any event by the Long Stop Date. A party that becomes aware of anything that will or may prevent a condition being satisfied must notify the others in writing immediately.',
        'If the conditions are not satisfied or waived by the Long Stop Date this agreement terminates automatically, and no party has any claim against any other except in respect of a prior breach and except for the clauses expressed to survive termination.',
      ],
    },
    {
      heading: '5. Completion',
      paragraphs: [
        'Completion takes place at the offices of the Buyer solicitors on the third business day after the last of the conditions is satisfied or waived, or at such other place and time as the parties agree in writing.',
        'At Completion the Sellers must deliver the documents listed in Part 1 of Schedule 3, including duly executed transfers of the Shares, the certificates for the Shares, the statutory registers, and the written resignations of those directors identified by the Buyer at least five business days beforehand.',
        'If a party fails to comply with a material obligation in this clause the other may defer Completion by up to twenty business days, proceed to Completion so far as practicable, or terminate this agreement by written notice.',
      ],
    },
    {
      heading: '6. Warranties',
      paragraphs: [
        'Each Seller warrants to the Buyer that each Warranty is true, accurate and not misleading at the date of this agreement and, save where a Warranty is expressed to be given at a particular date, immediately before Completion by reference to the facts then existing.',
        'The Warranties are qualified by the matters Disclosed and by nothing else. No knowledge of the Buyer or of its advisers, and no investigation made by or on behalf of the Buyer, prejudices any claim under the Warranties or reduces any amount recoverable.',
        'Each Warranty is separate and independent and is not limited by reference to any other Warranty or by anything else in this agreement.',
      ],
    },
    {
      heading: '7. Limitations on liability',
      paragraphs: [
        'The Sellers are not liable in respect of a Warranty Claim unless the amount of the claim exceeds the de minimis figure and the aggregate of all such claims exceeds the threshold, in which case the Sellers are liable for the whole amount and not only the excess.',
        'The aggregate liability of each Seller for all claims under this agreement is limited to the consideration actually received by that Seller, save in the case of fraud or fraudulent misrepresentation by that Seller, where no limit applies.',
        'A Warranty Claim is unenforceable unless written notice giving reasonable detail of the claim is served on the Sellers within eighteen months of the Completion Date, and proceedings are issued and served within six months of that notice.',
      ],
    },
    {
      heading: '8. Restrictive covenants',
      paragraphs: [
        'Each Seller covenants that it will not, for three years after Completion, carry on or be engaged in any business that competes with the business of the Company as carried on at Completion in any territory in which the Company traded in the twelve months before Completion.',
        'Each Seller further covenants that it will not, for three years after Completion, solicit or seek to entice away any person who was at Completion a senior employee, customer or supplier of the Company.',
        'Each covenant in this clause is a separate undertaking and is enforceable separately. If any covenant is void but would be valid if some part of it were deleted, it applies with such deletion as is necessary to make it valid.',
      ],
    },
    {
      heading: '9. Confidentiality and announcements',
      paragraphs: [
        'Each party must keep confidential the terms of this agreement and any information it receives about the other parties in connection with it, and may disclose that information only as permitted by this clause.',
        'No announcement concerning the transaction may be made by any party without the prior written approval of the others, save for an announcement required by law or by a regulatory authority, in which case the party making it must consult the others so far as practicable beforehand.',
      ],
    },
    {
      heading: '10. General',
      paragraphs: [
        'This agreement, together with the documents referred to in it, constitutes the entire agreement between the parties and supersedes any prior agreement or understanding relating to its subject matter.',
        'A variation of this agreement is valid only if it is in writing and signed by or on behalf of each party. A waiver of a right under this agreement is effective only if given in writing and is not a waiver of any subsequent breach.',
        'This agreement and any dispute arising out of it are governed by the law of England and Wales, and the parties submit to the exclusive jurisdiction of the courts of England and Wales.',
      ],
    },
    {
      heading: 'Note for the data room',
      paragraphs: [
        'This is a specimen document prepared for a demonstration data room. It is not legal advice, it records no real transaction, and it should not be used as a precedent.',
      ],
    },
  ],
};

const DEED_OF_ADHERENCE: PdfDocument = {
  title: 'Deed of Adherence',
  reference: 'Project Atlas | Executed 3 April 2026',
  sections: [
    {
      heading: 'This deed is made by',
      paragraphs: [
        'K. Osei of 22 Chandler Street, Bristol, BS1 5TG (the New Shareholder), in favour of the persons whose names are set out in the schedule to the Shareholders Agreement dated 9 September 2021 (the Shareholders Agreement).',
      ],
    },
    {
      heading: '1. Adherence',
      paragraphs: [
        'The New Shareholder confirms that it has been supplied with a copy of the Shareholders Agreement and undertakes to each of the existing parties to it to observe and perform all the provisions of that agreement that are capable of applying to the New Shareholder.',
        'This deed takes effect from the date on which the New Shareholder is entered in the register of members of the company as the holder of the shares transferred to it.',
      ],
    },
    {
      heading: '2. Notices',
      paragraphs: [
        'The address of the New Shareholder for the purposes of the notices provision of the Shareholders Agreement is the address set out above, until changed by written notice to the company.',
      ],
    },
    {
      heading: '3. Governing law',
      paragraphs: [
        'This deed and any dispute arising out of it are governed by the law of England and Wales.',
        'Executed as a deed and delivered on the date written above. This is a specimen document prepared for a demonstration data room.',
      ],
    },
  ],
};

const FINANCIALS: PdfDocument = {
  title: 'Annual Report and Financial Statements FY25',
  reference: 'Atlas Components Limited | Year ended 31 March 2025',
  sections: [
    {
      heading: 'Strategic report',
      paragraphs: [
        'Revenue for the year was GBP 24.6 million, an increase of 8.4 per cent on the prior year. Growth was driven by the automation division, where two long-term supply agreements signed in the second half of FY24 contributed a full year of volume.',
        'Gross margin improved by 110 basis points to 34.2 per cent, reflecting a better mix and the completion of the Marlow line upgrade. Operating expenses grew more slowly than revenue, and operating profit rose to GBP 3.1 million from GBP 2.4 million.',
        'The directors consider the principal risks to be customer concentration, input cost volatility in specialist alloys, and the availability of skilled machining staff in the Reading area. Mitigations are described in the risk section below.',
      ],
    },
    {
      heading: 'Summary of results',
      paragraphs: [
        'Revenue GBP 24.6m (FY24: GBP 22.7m). Gross profit GBP 8.4m (FY24: GBP 7.5m). Operating profit GBP 3.1m (FY24: GBP 2.4m). Profit before tax GBP 2.9m (FY24: GBP 2.2m).',
        'Net cash generated from operating activities was GBP 3.4 million. Capital expenditure of GBP 1.2 million was incurred, principally on the second machining cell. Net debt at the year end was GBP 1.9 million, down from GBP 2.6 million.',
      ],
    },
    {
      heading: 'Principal risks and uncertainties',
      paragraphs: [
        'Customer concentration. The two largest customers accounted for 29 per cent of revenue in the year. Both are under framework agreements running to at least March 2027. The board monitors the pipeline of new accounts monthly.',
        'Input costs. Specialist alloy prices rose 6 per cent during the year. Approximately 60 per cent of volume is covered by contractual pass-through mechanisms; the balance is managed through forward purchasing of up to six months.',
        'People. The company competes for skilled machinists with several larger employers in the region. Retention in the year was 91 per cent, and an apprenticeship intake of six began in September.',
      ],
    },
    {
      heading: 'Going concern',
      paragraphs: [
        'The directors have reviewed cash flow forecasts covering the period to 31 March 2027, including a severe but plausible downside in which revenue falls by 15 per cent and gross margin by 200 basis points. In that scenario the company continues to operate within its facilities.',
        'Accordingly the directors continue to adopt the going concern basis in preparing these financial statements.',
      ],
    },
    {
      heading: 'Directors and advisers',
      paragraphs: [
        'Directors: J. Okonjo, R. Vance, S. Lindqvist, M. Haddad. Company secretary: T. Reyes. Registered auditor: Halloway Pike LLP, Reading. Bankers: Southbank Commercial, Reading.',
      ],
    },
    {
      heading: 'Note for the data room',
      paragraphs: [
        'These are specimen financial statements prepared for a demonstration data room. The figures are illustrative and describe no real company.',
      ],
    },
  ],
};

const AUDITORS_REPORT: PdfDocument = {
  title: 'Independent Auditors Report',
  reference: 'To the members of Atlas Components Limited | FY25',
  sections: [
    {
      heading: 'Opinion',
      paragraphs: [
        'We have audited the financial statements of Atlas Components Limited for the year ended 31 March 2025, which comprise the income statement, the balance sheet, the statement of changes in equity, the cash flow statement and the related notes.',
        'In our opinion the financial statements give a true and fair view of the state of the company affairs as at 31 March 2025 and of its profit for the year then ended, have been properly prepared in accordance with United Kingdom Generally Accepted Accounting Practice, and have been prepared in accordance with the requirements of the Companies Act 2006.',
      ],
    },
    {
      heading: 'Basis for opinion',
      paragraphs: [
        'We conducted our audit in accordance with International Standards on Auditing (UK) and applicable law. Our responsibilities under those standards are described in the auditors responsibilities section of our report.',
        'We are independent of the company in accordance with the ethical requirements that are relevant to our audit of the financial statements in the UK, and we have fulfilled our other ethical responsibilities in accordance with these requirements. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our opinion.',
      ],
    },
    {
      heading: 'Key audit matters',
      paragraphs: [
        'Revenue recognition on long-term supply agreements. We evaluated the terms of the two framework agreements, tested a sample of deliveries against customer acknowledgements, and reperformed the cut-off testing around the year end.',
        'Inventory valuation. We attended the year-end count at the Marlow site, tested the standard cost build for a sample of finished goods, and challenged the provision held against slow-moving raw material.',
      ],
    },
    {
      heading: 'Conclusions relating to going concern',
      paragraphs: [
        'Based on the work we have performed, we have not identified any material uncertainties relating to events or conditions that, individually or collectively, may cast significant doubt on the company ability to continue as a going concern for a period of at least twelve months from when the financial statements are authorised for issue.',
      ],
    },
    {
      heading: 'Note for the data room',
      paragraphs: [
        'This is a specimen report prepared for a demonstration data room. It was issued by no firm and audits no company.',
      ],
    },
  ],
};

const MUTUAL_NDA: PdfDocument = {
  title: 'Mutual Non-Disclosure Agreement',
  reference:
    'Atlas Components Limited and Northgate Industrial Holdings plc | 2 March 2026',
  sections: [
    {
      heading: '1. Purpose',
      paragraphs: [
        'The parties wish to explore a possible transaction involving the acquisition by Northgate Industrial Holdings plc of the entire issued share capital of Atlas Components Limited (the Purpose). In connection with the Purpose each party may disclose Confidential Information to the other.',
      ],
    },
    {
      heading: '2. Confidential Information',
      paragraphs: [
        'Confidential Information means all information of a confidential nature disclosed by or on behalf of one party to the other, whether before or after the date of this agreement, in any form, and whether or not marked as confidential. It includes the fact that discussions are taking place and the terms on which they are taking place.',
        'Confidential Information does not include information that is or becomes public other than through a breach of this agreement, that the receiving party already held free of any obligation of confidence, that is lawfully received from a third party free of any such obligation, or that the receiving party develops independently without use of the other party information.',
      ],
    },
    {
      heading: '3. Undertakings',
      paragraphs: [
        'Each party undertakes to keep the other Confidential Information confidential, to use it only for the Purpose, and not to disclose it to any person except as permitted by clause 4.',
        'Each party must apply at least the same degree of care to the other Confidential Information as it applies to its own, and in no event less than a reasonable degree of care.',
      ],
    },
    {
      heading: '4. Permitted disclosures',
      paragraphs: [
        'A party may disclose Confidential Information to those of its officers, employees and professional advisers who need to know it for the Purpose, provided that it informs them of its confidential nature and remains responsible for their compliance.',
        'A party may disclose Confidential Information to the extent required by law, by a court of competent jurisdiction, or by a regulatory authority, provided that, so far as it is lawful and practicable to do so, it gives the other party prior notice.',
      ],
    },
    {
      heading: '5. Return and destruction',
      paragraphs: [
        'On written request each party must return or destroy all Confidential Information in its possession, and delete it from its systems, save for one copy retained for the purpose of complying with a legal or regulatory requirement and for copies held in routine backups that are not readily accessible.',
      ],
    },
    {
      heading: '6. Term and general',
      paragraphs: [
        'The obligations in this agreement continue for three years from the date of this agreement, and survive any decision by either party not to proceed with the Purpose.',
        'Nothing in this agreement obliges either party to disclose any information, to continue discussions, or to enter into any further agreement. No licence under any intellectual property right is granted by this agreement.',
        'This agreement is governed by the law of England and Wales. This is a specimen document prepared for a demonstration data room.',
      ],
    },
  ],
};

const INFORMATION_MEMORANDUM: PdfDocument = {
  title: 'Confidential Information Memorandum',
  reference: 'Project Borealis | Draft for discussion | July 2026',
  sections: [
    {
      heading: 'Important notice',
      paragraphs: [
        'This memorandum has been prepared for the sole purpose of assisting recipients in deciding whether to proceed with a further investigation of the opportunity described. It does not constitute an offer or an invitation to treat, and no representation or warranty is given as to the accuracy of the information it contains.',
      ],
    },
    {
      heading: 'The opportunity',
      paragraphs: [
        'Borealis Analytics Ltd provides condition-monitoring software to operators of industrial rotating equipment. The company was founded in 2019, employs 34 people across Bristol and Gdansk, and serves 61 customers in eleven countries.',
        'The shareholders are seeking a minority investment of GBP 6 to 8 million to fund the North American go-to-market and to accelerate the sensor-agnostic ingestion roadmap.',
      ],
    },
    {
      heading: 'Financial summary',
      paragraphs: [
        'Annual recurring revenue at 30 June 2026 was GBP 4.2 million, growing 41 per cent year on year. Net revenue retention over the last twelve months was 114 per cent, and gross margin was 81 per cent.',
        'The company reached breakeven on a monthly basis in March 2026 and holds GBP 1.4 million of cash with no debt.',
      ],
    },
    {
      heading: 'Process',
      paragraphs: [
        'Indicative offers are requested by 18 September 2026. Shortlisted parties will be given access to a full data room and to management, and will be asked to submit final proposals in November.',
        'All enquiries should be directed to the financial adviser named in the process letter and not to the company or its employees.',
      ],
    },
    {
      heading: 'Note for the data room',
      paragraphs: [
        'This is a specimen document prepared for a demonstration data room. It describes no real company and offers nothing to anybody.',
      ],
    },
  ],
};

export const ROOMS: SeedRoom[] = [
  {
    name: 'Project Atlas',
    folders: [
      {
        name: '01 Corporate',
        files: [
          {
            name: 'Certificate of Incorporation.pdf',
            document: CERTIFICATE,
          },
          {
            name: 'Board Minutes 12 March 2026.pdf',
            document: BOARD_MINUTES,
          },
        ],
        folders: [
          {
            name: 'Shareholder Agreements',
            files: [
              {
                name: 'Share Purchase Agreement.pdf',
                document: SHARE_PURCHASE_AGREEMENT,
              },
              { name: 'Deed of Adherence.pdf', document: DEED_OF_ADHERENCE },
            ],
          },
        ],
      },
      {
        name: '02 Financial',
        files: [{ name: 'Financials FY25.pdf', document: FINANCIALS }],
        folders: [
          {
            name: 'Audit',
            files: [
              {
                name: 'Auditors Report FY25.pdf',
                document: AUDITORS_REPORT,
              },
            ],
          },
        ],
      },
      {
        name: '03 Legal',
        files: [{ name: 'Mutual NDA.pdf', document: MUTUAL_NDA }],
      },
    ],
  },
  {
    name: 'Project Borealis',
    folders: [
      {
        name: '01 Teaser',
        files: [
          {
            name: 'Information Memorandum.pdf',
            document: INFORMATION_MEMORANDUM,
          },
        ],
      },
    ],
  },
];
