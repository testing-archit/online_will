# Octaraa Online Will — Complete Tech Task List

## P0 — Foundation / Must Do First

### 1. **Convert the Static Questionnaire into a Dynamic Decision-Tree Form**

**Priority: P0 — Critical**

Replace the current linear questionnaire with conditional sections.

Example:

```
Do you have children?
       │
    ┌──┴──┐
   Yes    No
    │
Are any minors?
    │
   Yes
    ↓
Guardian questions
```

**Tasks**

- Define every question and its dependencies.
- Create a questionnaire schema in JSON/database.
- Implement conditional question rendering.
- Save progress automatically.
- Allow users to resume later.
- Add validation for mandatory fields.
- Add section-level completion percentage.
- Add "review answers" before submission.

**Why:** This reduces unnecessary questions and creates the foundation for every AI feature later.

---

### 2. **Create a Structured Estate Data Model**

**Priority: P0**

Stop treating the submission as one giant form response.

Create proper entities:

```
User
Family
Family Member
Asset
Liability
Insurance Policy
Nomination
Beneficiary
Executor
Guardian
Will
Document
Distribution Instruction
Execution Event
```

For example:

```
Asset
├── type
├── owner
├── value
├── ownership_percentage
├── nominee
├── beneficiary
├── document
└── instructions
```

**Tasks**

- Design PostgreSQL schema.
- Create relationships between family members and assets.
- Add audit timestamps.
- Add versioning.
- Store questionnaire answers separately from derived AI information.
- Maintain immutable historical versions.

**Why:** Without this, the AI layer becomes a collection of hacks around form responses.

---

### 3. **Build an Estate Profile Dashboard**

**Priority: P0**

After submission, automatically create:

> **Your Estate Profile**

Showing:

- Family members
- Beneficiaries
- Executors
- Guardians
- Assets
- Liabilities
- Insurance
- Distribution instructions
- Missing information
- Documents
- Execution status

**Tasks**

- Build dashboard UI.
- Create summary cards.
- Create family tree.
- Create asset list.
- Create beneficiary mapping.
- Add completion status.

---

### 4. **Automate Report Generation**

**Priority: P0**

Current:

```
Form → Manual/report generation → Email
```

Change to:

```
Submission
   ↓
Validation
   ↓
Structured estate data
   ↓
Report generator
   ↓
PDF
   ↓
Automatic distribution
```

Generate separate reports:

**Client Report**

- Estate summary
- Family structure
- Assets
- Intended distribution
- Missing information
- Next steps

**Advisor Report**

- Client summary
- Estate size
- Asset categories
- Beneficiaries
- Planning gaps

**Lawyer Brief**

- Detailed structured information
- Potential inconsistencies
- Questions requiring legal review

---

### 5. **Build Automated Email + Notification Workflow**

**Priority: P0**

Remove manual emailing.

Events:

```
Questionnaire completed
        ↓
Generate reports
        ↓
Email client
        ↓
Email advisor
        ↓
Notify lawyer/team
```

Use templated emails.

Also support:

- submission confirmation
- document request
- missing information reminder
- lawyer assignment
- draft ready
- review required
- execution scheduled

---

## P1 — AI Automation Layer

### 6. **AI Questionnaire Assistant**

**Priority: P1 — Highest AI priority**

Allow users to answer naturally instead of only filling fields.

Example:

> "I have a house in Noida which I want my daughter to get."

AI extracts:

```
Asset: Noida House
Intended beneficiary: Daughter
Distribution type: Specific bequest
```

Then asks:

> "What is the approximate value of the property?"

**Tasks**

- Build conversational interface.
- Define structured output schema.
- Add function/tool calling.
- Map AI output to estate entities.
- Require confirmation for extracted information.
- Store original user statement + structured interpretation.

---

### 7. **AI Missing Information Detector**

**Priority: P1**

Continuously inspect the estate profile.

Example:

> You listed three children but only assigned two beneficiaries.

Or:

> You have added an insurance policy but haven't provided nominee information.

Or:

> You have appointed a primary executor but no alternate executor.

The questionnaire already explicitly captures primary/alternate executors and guardians.

**Tasks**

- Define deterministic completeness rules.
- Add AI-based contextual checks.
- Generate missing-information tasks.
- Show them in dashboard.
- Prevent final submission until mandatory issues are resolved.

---

### 8. **AI Contradiction Detection**

**Priority: P1**

Detect conflicts between answers.

Example:

> "I want everything to go to my wife."

Later:

> "Noida property → son."

System:

> ⚠️ Potential inconsistency detected.

Then ask the user to resolve it.

**Tasks**

- Compare answers across sections.
- Compare natural-language answers.
- Compare distribution instructions.
- Detect conflicting beneficiaries.
- Detect contradictory executor/guardian instructions.
- Maintain an unresolved-issues queue.

---

### 9. **AI Estate Summary Generator**

**Priority: P1**

Generate a clean summary from structured information.

Example:

```
Estate Overview

Estimated estate value: ₹8.4 Cr

Family:
• Spouse
• 2 children

Assets:
• 2 properties
• Mutual funds
• Bank deposits
• Insurance
• Business interest

Primary beneficiary:
Spouse

Specific bequests:
Property A → Daughter
```

**Important:** AI should summarize recorded information, not invent legal conclusions.

---

### 10. **AI Lawyer Brief Generator**

**Priority: P1**

This should become one of the biggest time-saving features.

Automatically generate:

```
CLIENT
FAMILY
ASSETS
LIABILITIES
DISTRIBUTION
EXECUTORS
GUARDIANS
NOMINATIONS
OPEN QUESTIONS
DOCUMENTS
POTENTIAL CONFLICTS
```

The lawyer gets the relevant information without manually reading the entire questionnaire.

---

## P1 — Document Intelligence

### 11. **Document Upload & Secure Vault**

**Priority: P1**

Allow:

> Upload documents

Supported categories:

- PAN
- ID
- Property documents
- Bank statements
- CAS
- Demat statements
- Insurance
- Loan documents
- Business documents
- Vehicle documents
- Existing Will

Your current document checklist already identifies these categories.

**Architecture**

```
Frontend
 ↓
Signed upload URL
 ↓
Cloud Storage
 ↓
Document processing queue
```

---

### 12. **AI Document Classification**

**Priority: P1**

Automatically determine:

```
Upload PDF
   ↓
Document AI
   ↓
Property deed
```

or:

```
Upload PDF
   ↓
Insurance policy
```

or:

```
CAS
```

**Tasks**

- Document classification.
- OCR.
- Metadata extraction.
- Confidence score.
- Manual correction mechanism.

---

### 13. **AI Asset Extraction**

**Priority: P1**

Extract structured information from documents.

Example:

```
CAS.pdf
     ↓
Mutual Fund
     ↓
Scheme
Units
Value
Holder
Nominee
```

Then ask:

> "We found these assets. Confirm?"

Never silently add extracted data to the final estate.

---

### 14. **Questionnaire ↔ Document Reconciliation**

**Priority: P1**

This is where your system becomes genuinely intelligent.

Example:

```
Questionnaire:
Property value = ₹2.5 Cr

Document:
Property value/reference = ₹3.1 Cr

→ Mismatch
```

Another:

```
Questionnaire:
Owner = Archit

Document:
Owners = Archit + Spouse

→ Mismatch
```

**Output:**

> ⚠️ Please verify ownership information.

---

## P1 — Estate Intelligence

### 15. **Nomination vs Beneficiary Alignment Engine**

**Priority: P1**

Your existing questionnaire specifically asks for insurance nominees and intended beneficiaries.

Create:

```
Asset              Nominee       Intended Beneficiary

Insurance          Wife          Wife             ✓

MF                 Brother       Wife             ⚠

FD                 Father        Daughter         ⚠
```

The platform should **flag the difference**, not independently declare the legal consequence.

---

### 16. **Estate Completeness / Readiness Score**

**Priority: P1**

Create an operational score such as:

#### Estate Preparation

**78% complete**

```
Family Information      100%
Asset Inventory           85%
Beneficiaries            100%
Nominations               62%
Documents                 70%
Executors                100%
Contingencies              40%
Execution                 20%
```

Avoid presenting this as a legal validity score.

It's a **workflow completeness score**.

---

### 17. **Family Relationship Graph**

**Priority: P1**

Visual representation:

```
                 Testator
                /        \
             Spouse      Child
                         /   \
                       Son  Daughter
```

Each person should contain:

- relationship
- age
- beneficiary status
- executor status
- guardian status
- assigned assets

---

### 18. **Asset → Beneficiary Mapping**

**Priority: P1**

Create a visual map:

```
Noida Property ─────→ Daughter

MF Portfolio ────────→ Wife

FD ──────────────────→ Son

Business ────────────→ Son
```

This makes complex estate structures understandable.

---

## P2 — Advanced AI

### 19. **Estate Copilot**

**Priority: P2**

A conversational interface over the user's estate data.

User:

> "What assets have I assigned to my daughter?"

AI:

> "You've currently assigned..."

User:

> "What happens if my primary executor cannot act?"

AI should retrieve the recorded alternate executor information.

The critical architecture:

```
User question
      ↓
Intent detection
      ↓
Estate database
      ↓
Relevant documents/rules
      ↓
LLM
      ↓
Answer
```

Not:

```
User → LLM → hallucination
```

---

### 20. **What-If / Scenario Engine**

**Priority: P2**

Examples:

> What happens if my wife dies before me?

> What if my primary executor cannot act?

> What happens to my daughter's inheritance if she predeceases me?

Your questionnaire already captures predeceasing beneficiaries and substitute beneficiaries.

Build scenario simulations around those recorded instructions.

---

### 21. **Distribution Simulator**

**Priority: P2**

Allow users to experiment with:

```
Spouse      50%
Son         25%
Daughter    25%
```

or specific assets:

```
Property → Daughter
MF → Wife
Business → Son
```

Then visualize the resulting allocation.

---

### 22. **AI Follow-up Question Engine**

**Priority: P2**

Instead of hardcoding every possible follow-up:

```
User answer
     ↓
AI evaluates context
     ↓
Generates relevant follow-up
```

Example:

> "You mentioned that your son runs your business. Do you want to provide any specific succession instructions?"

The generated question should still be constrained by approved question templates/rules.

---

### 23. **Voice Estate Interview**

**Priority: P2**

Allow the user to speak instead of type.

```
Voice
 ↓
Speech-to-text
 ↓
Estate AI
 ↓
Structured data
 ↓
Confirmation
```

This is particularly useful for older clients.

---

### 24. **Hindi / Hinglish Estate Interview**

**Priority: P2**

Example:

> "Aapke paas koi property hai jo aap specifically kisi family member ko dena chahte hain?"

Internally:

```
Hindi/Hinglish
       ↓
Structured English data
```

The user experience can remain conversational while your backend remains standardized.

---

## P2 — Lawyer / Execution Automation

### 25. **Lawyer Workspace**

**Priority: P2**

Lawyer dashboard:

```
Assigned Cases
      ↓
Client Profile
      ↓
Documents
      ↓
AI Summary
      ↓
Open Issues
      ↓
Draft
      ↓
Client Review
```

Lawyer can:

- approve information
- correct information
- add comments
- request documents
- mark issues resolved
- upload final draft

---

### 26. **Client–Lawyer Collaboration**

**Priority: P2**

Instead of email chains:

```
Lawyer:
"Please upload latest property deed."

Client:
[Upload]

Lawyer:
"Please clarify beneficiary for FD."

Client:
[Answer]
```

Everything stays attached to the case.

---

### 27. **Automated Execution Checklist**

**Priority: P2**

Your source material already has execution-related requirements including the original signed Will, IDs, witnesses, photographs and supporting records.

Turn this into a live checklist:

```
☑ Final Will approved
☑ Testator ID
☑ PAN
☑ Witness 1
☑ Witness 2
☐ Medical certificate
☐ Registration appointment
☐ Registration completed
```

---

### 28. **Execution Room**

**Priority: P2**

Dedicated case room for:

- testator
- lawyer
- witnesses
- documents
- execution status
- appointment
- final Will
- video recording metadata

---

### 29. **Execution Recording Management**

**Priority: P2**

If the client chooses video recording, securely store the recording and associate it with the Will version.

Your questionnaire already asks whether execution will be videotaped.

Don't let AI claim that a video proves legal capacity or absence of undue influence. It can identify and timestamp observable events for human review.

---

## P3 — Turn It Into an Estate OS

### 30. **Family Legacy Vault**

**Priority: P3**

This is where the product stops being a one-time Will service.

Store:

```
Wills
Property documents
Insurance
Investments
Bank information
Business documents
Important contacts
Executor information
Digital asset instructions
```

Your source document already includes digital assets such as brokerages, wallets, cloud storage and custody instructions.

---

### 31. **Annual Estate Review**

**Priority: P3**

Automatically remind:

> "It's been 12 months since your last estate review."

Ask:

```
Marriage changed?
Children changed?
New property?
New investments?
New insurance?
New liabilities?
Business ownership changed?
Executor changed?
```

---

### 32. **Event-Based Estate Review**

**Priority: P3**

Trigger a review after user-confirmed events such as:

- marriage
- birth/adoption
- divorce
- new property
- major asset acquisition
- new insurance
- business ownership change
- death of beneficiary
- executor becoming unavailable

---

### 33. **Digital Asset & Legacy Planning**

**Priority: P3**

Dedicated section for:

- digital accounts
- cloud storage
- brokerage accounts
- crypto
- important digital records
- executor instructions

Never store actual passwords directly in the Will database. Your source material itself recommends keeping actual passwords in a separate memorandum.

---

### 34. **Post-Death Executor Workflow**

**Priority: P3 — Long-term differentiator**

Eventually:

```
Death reported
      ↓
Executor authenticated
      ↓
Estate inventory
      ↓
Liabilities
      ↓
Assets
      ↓
Beneficiary mapping
      ↓
Documents
      ↓
Distribution tracking
```

This is the point where Octaraa could evolve from **Will execution** into **estate administration infrastructure**.

---

## P4 — Advanced Platform Layer

### 35. **AI Estate Document Search**

**Priority: P4**

User:

> "Find my insurance policy."

> "Which property documents do I have?"

> "Show me everything related to my Noida property."

RAG searches the user's authorized document vault.

---

### 36. **AI Legal Knowledge Assistant**

**Priority: P4**

Create a controlled knowledge base containing approved legal materials.

Architecture:

```
User question
 ↓
Retrieve relevant approved source
 ↓
LLM
 ↓
Answer + source
```

Do **not** allow the general model to invent legal rules.

---

### 37. **State / Jurisdiction Rules Engine**

**Priority: P4**

Create a configurable rules layer:

```
Jurisdiction
     ↓
Applicable workflow requirements
     ↓
Execution checklist
```

Your questionnaire itself already distinguishes Uttarakhand's stated registration requirement from the general registration treatment it describes elsewhere.

This should be maintained as a **versioned rules engine**, because legal requirements can change.

---

### 38. **Compliance & Audit Trail**

**Priority: P4**

Every important event should be logged:

```
Who
What
When
Before
After
IP/device metadata where appropriate
Document version
```

Example:

```
14:32
Client changed:
Beneficiary
Son → Daughter

14:34
Client confirmed change

14:35
Lawyer notified
```

For a legal-document workflow, this is much more important than another flashy AI feature.

---

## P5 — Future / Experimental

### 39. **AI Execution Video Analysis**

**Priority: P5**

Analyze execution recordings for observable events:

- signing detected
- witnesses present
- Will reading detected
- timestamps
- participant identification

Keep the output as **review assistance**, not a legal determination.

---

### 40. **AI Estate Risk / Gap Analysis**

**Priority: P5**

Generate:

```
Estate Planning Gaps

⚠ No alternate executor
⚠ 3 assets without nomination information
⚠ Beneficiary inconsistency
⚠ Property document missing
⚠ Digital assets incomplete
```

Again, call these **planning gaps**, not "legal risks" unless counsel has defined the
