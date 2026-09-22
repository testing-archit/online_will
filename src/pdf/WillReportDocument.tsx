import { listAssets } from '../lib/assetMapping'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import octaraaLogo from '../assets/octaraa-logo.png'
import { computeAge } from '../lib/age'
import { formatAddress, generateDraftText } from '../lib/draftText'
import {
  COMPENSATION_LABEL,
  DEBT_SETTLEMENT_LABEL,
  DISTRIBUTION_SCHEME_LABEL,
  RELATIONSHIP_LABEL,
  RELIGION_LABEL,
} from '../lib/labels'
import { computeLegalFlags, flagCounts } from '../lib/legalRules'
import type { ConsultationRequest, FlagSeverity, WillData } from '../lib/types'
import {
  DataTable,
  FlagCard,
  GroupedAssetTable,
  InfoGrid,
  PdfCallout,
  ReportPage,
  Section,
  StatCardRow,
} from './components'
import { registerPdfFonts } from './fonts'
import { pdfColors } from './theme'

registerPdfFonts()

function formatToday(): string {
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

const coverStyles = StyleSheet.create({
  page: {
    backgroundColor: pdfColors.primary,
    fontFamily: 'Figtree',
    padding: 48,
    flexDirection: 'column',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoCard: {
    backgroundColor: pdfColors.white,
    borderRadius: 10,
    paddingVertical: 18,
    paddingHorizontal: 26,
    alignItems: 'center',
  },
  logoImg: { width: 130, height: 40 },
  hr: { width: 48, height: 2, backgroundColor: pdfColors.secondary, marginTop: 30, marginBottom: 22 },
  title: { fontFamily: 'Lexend', fontSize: 28, fontWeight: 700, color: pdfColors.white, textAlign: 'center', lineHeight: 1.25 },
  subtitle: { fontSize: 9, letterSpacing: 2, color: '#aab0e8', marginTop: 14, textAlign: 'center' },
  preparedFor: { fontSize: 8, letterSpacing: 2, color: '#aab0e8', marginTop: 60 },
  clientName: { fontFamily: 'Lexend', fontSize: 18, fontWeight: 700, color: pdfColors.secondary, marginTop: 8 },
  footer: { borderTopWidth: 1, borderTopColor: '#2a3199', paddingTop: 12, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7.5, color: '#aab0e8' },
})

function CoverPage({ testatorName, date }: { testatorName: string; date: string }) {
  return (
    <Page size="A4" style={coverStyles.page}>
      <View style={coverStyles.center}>
        <View style={coverStyles.logoCard}>
          <Image src={octaraaLogo} style={coverStyles.logoImg} />
        </View>
        <View style={coverStyles.hr} />
        <Text style={coverStyles.title}>Last Will & Testament{'\n'}Draft for Legal Review</Text>
        <Text style={coverStyles.subtitle}>PRIVATE & CONFIDENTIAL</Text>
        <Text style={coverStyles.preparedFor}>PREPARED FOR</Text>
        <Text style={coverStyles.clientName}>{testatorName || 'Prospective Testator'}</Text>
      </View>
      <View style={coverStyles.footer}>
        <Text style={coverStyles.footerText}>Prepared by Octaraa Estate Planning</Text>
        <Text style={coverStyles.footerText}>Date: {date} · Octaraa Wealth Advisory</Text>
      </View>
    </Page>
  )
}

const draftStyles = StyleSheet.create({
  draftBox: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 6, padding: 14, backgroundColor: pdfColors.panel },
  draftParagraph: { fontSize: 8.5, color: pdfColors.body, lineHeight: 1.6, marginBottom: 9 },
  draftHeading: { fontFamily: 'Lexend', fontSize: 8.5, fontWeight: 700, color: pdfColors.primary, marginBottom: 4, letterSpacing: 0.3 },
})

const disclaimerStyles = StyleSheet.create({
  box: { marginTop: 4 },
  text: { fontSize: 7.5, color: pdfColors.muted, lineHeight: 1.6 },
})

export function WillReportDocument({
  data,
  consultation,
}: {
  data: WillData
  consultation?: ConsultationRequest | null
}) {
  const flags = computeLegalFlags(data)
  const counts = flagCounts(flags)
  const draft = generateDraftText(data)
  const planDate = formatToday()
  const age = computeAge(data.personal.dateOfBirth)
  const executionReady = counts.critical === 0

  const primaryExecutors = data.executorsGuardians.executors.filter((e) => !e.isAlternate)
  const alternateExecutors = data.executorsGuardians.executors.filter((e) => e.isAlternate)
  const guardians = data.executorsGuardians.guardians

  const draftParagraphs = draft.split('\n\n')

  return (
    <Document title={`Will Draft — ${data.personal.fullLegalName || 'Octaraa Client'}`}>
      <CoverPage testatorName={data.personal.fullLegalName} date={planDate} />

      {/* Overview */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <StatCardRow
          cards={[
            {
              label: 'LEGAL FLAGS TO REVIEW',
              value: String(counts.critical),
              caption: `${counts.warning} to clarify · ${counts.info} informational`,
              variant: counts.critical > 0 ? 'accent' : 'default',
            },
            { label: 'BENEFICIARIES NAMED', value: String(data.distribution.beneficiaries.length) },
            {
              label: 'READY TO EXECUTE',
              value: executionReady ? 'Yes' : 'Not yet',
              caption: executionReady ? 'No critical issues open' : `${counts.critical} issue(s) open`,
              variant: 'filled',
            },
          ]}
        />

        <Section title="Testator Profile">
          <InfoGrid
            rows={[
              [
                { label: 'Full legal name', value: data.personal.fullLegalName },
                { label: 'Date of birth', value: data.personal.dateOfBirth ? `${data.personal.dateOfBirth}${age !== null ? ` (${age} yrs)` : ''}` : '' },
                { label: 'Religion & personal law', value: RELIGION_LABEL[data.personal.religion] ?? '' },
              ],
              [
                { label: 'Address', value: formatAddress(data.personal) },
                { label: 'State of execution', value: data.personal.state },
                { label: 'PIN code', value: data.personal.pincode },
              ],
            ]}
          />
        </Section>

        <Section title="Legal Review Summary">
          <PdfCallout tone={counts.critical > 0 ? 'critical' : counts.warning > 0 ? 'warning' : 'info'}>
            {counts.critical} item{counts.critical === 1 ? '' : 's'} need legal review before this draft is ready to
            print and sign, {counts.warning} {counts.warning === 1 ? 'is' : 'are'} worth clarifying, and {counts.info}{' '}
            {counts.info === 1 ? 'is' : 'are'} informational only. Full detail follows on the next page.
          </PdfCallout>
          <PdfCallout tone="info">
            This document is a drafting aid, not a legally executed Will. Under Section 63 of the Indian Succession
            Act, 1925, execution requires the testator to sign a printed copy in the simultaneous presence of two
            witnesses, who then also sign. Nothing in this PDF substitutes that step.
          </PdfCallout>
        </Section>
      </ReportPage>

      {/* Legal flags detail */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <Section title="Legal Flags & Considerations">
          {flags.length === 0 ? (
            <PdfCallout tone="info">No issues detected from the information provided so far.</PdfCallout>
          ) : (
            (['critical', 'warning', 'info'] as FlagSeverity[]).map((severity) => {
              const items = flags.filter((f) => f.severity === severity)
              if (!items.length) return null
              return items.map((flag) => (
                <FlagCard key={flag.id} severity={flag.severity} title={flag.title} description={flag.description} />
              ))
            })
          )}
        </Section>
      </ReportPage>

      {/* Roles & assets */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <Section title="Executors & Guardians">
          <DataTable
            columns={[
              { key: 'name', label: 'Name', width: 26 },
              { key: 'role', label: 'Role', width: 16 },
              { key: 'relationship', label: 'Relationship', width: 20 },
              { key: 'age', label: 'Age', width: 10 },
              { key: 'address', label: 'Address', width: 28 },
            ]}
            rows={[...primaryExecutors, ...alternateExecutors]
              .filter((e) => e.fullName)
              .map((e) => ({
                name: e.fullName,
                role: e.isAlternate ? 'Alternate executor' : 'Primary executor',
                relationship: e.relationship,
                age: e.age,
                address: e.address,
              }))}
          />
          <Text style={{ fontSize: 7.5, color: pdfColors.muted, marginTop: 4 }}>
            Compensation: {COMPENSATION_LABEL[data.executorsGuardians.compensation] ?? 'Not specified'}
          </Text>

          {data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren && (
            <View style={{ marginTop: 10 }}>
              <DataTable
                columns={[
                  { key: 'name', label: 'Guardian', width: 26 },
                  { key: 'role', label: 'Role', width: 16 },
                  { key: 'relationship', label: 'Relationship', width: 20 },
                  { key: 'address', label: 'Address', width: 20 },
                  { key: 'financial', label: 'Financial instructions', width: 18 },
                ]}
                rows={guardians
                  .filter((g) => g.fullName)
                  .map((g) => ({
                    name: g.fullName,
                    role: g.isAlternate ? 'Alternate guardian' : 'Primary guardian',
                    relationship: g.relationship,
                    address: g.address,
                    financial: g.financialInstructions,
                  }))}
              />
            </View>
          )}
        </Section>

        <Section title="Asset Inventory">
          <GroupedAssetTable
            groups={[
              {
                label: 'Immovable property',
                rows: data.assets.immovableAssets.map((a) => ({
                  primary: a.address,
                  secondary: [a.surveyNumber, a.registryDetails, a.ownershipShare, a.estimatedValue && `Value ${a.estimatedValue}`].filter(Boolean).join(' · '),
                })),
              },
              {
                label: 'Bank accounts & fixed deposits',
                rows: data.assets.bankAccounts.map((a) => ({
                  primary: [a.bankName, a.branch].filter(Boolean).join(' — '),
                  secondary: [a.accountNumber && `A/C ${a.accountNumber}`, a.estimatedValue && `Balance ${a.estimatedValue}`, a.nomineeName && `Nominee ${a.nomineeName}`].filter(Boolean).join(' · '),
                })),
              },
              {
                label: 'Investments',
                rows: data.assets.investments.map((a) => ({
                  primary: [a.type, a.description].filter(Boolean).join(' — '),
                  secondary: [a.identifier, a.estimatedValue && `Value ${a.estimatedValue}`, a.nomineeName && `Nominee ${a.nomineeName}`].filter(Boolean).join(' · '),
                })),
              },
              {
                label: 'Valuables',
                rows: data.assets.valuables.map((v) => ({
                  primary: v.description,
                  secondary: v.estimatedValue,
                })),
              },
            ]}
          />
          {data.assets.hasEncumberedAssets && (
            <View style={{ marginTop: 8 }}>
              <PdfCallout tone="warning">
                Encumbrances: {data.assets.encumbranceDetails || 'Details not yet provided.'} Liabilities to be settled{' '}
                {DEBT_SETTLEMENT_LABEL[data.assets.debtSettlementMethod]?.toLowerCase() ?? '[method not specified]'}.
              </PdfCallout>
            </View>
          )}
        </Section>
      </ReportPage>

      {/* Distribution & insurance */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <Section title="Distribution of Estate">
          <Text style={{ fontSize: 8.5, color: pdfColors.muted, marginBottom: 6 }}>
            Scheme: {DISTRIBUTION_SCHEME_LABEL[data.distribution.scheme] ?? 'Not yet selected'}
          </Text>
          <DataTable
            columns={[
              { key: 'name', label: 'Beneficiary', width: 24 },
              { key: 'relationship', label: 'Relationship', width: 18 },
              { key: 'share', label: 'Share / asset', width: 28 },
              { key: 'substitute', label: 'If predeceased, passes to', width: 30 },
            ]}
            rows={data.distribution.beneficiaries.map((b) => ({
              name: b.name,
              relationship: RELATIONSHIP_LABEL[b.relationship] ?? '',
              share: [assignedNames(data, b.assignedAssetIds), b.share].filter(Boolean).join(' — '),
              substitute: b.substituteBeneficiary,
            }))}
          />
          {data.distribution.residuaryBeneficiary && (
            <Text style={{ fontSize: 8, color: pdfColors.body, marginTop: 6 }}>
              Ultimate residuary beneficiary (if all named beneficiaries fail): {data.distribution.residuaryBeneficiary}
            </Text>
          )}
        </Section>

        <Section title="Life Insurance & Nominations">
          <DataTable
            columns={[
              { key: 'insurer', label: 'Insurer', width: 22 },
              { key: 'policy', label: 'Policy number', width: 18 },
              { key: 'nominee', label: 'Nominee', width: 22 },
              { key: 'relationship', label: 'Relationship', width: 18 },
              { key: 'aligned', label: 'Aligned with Will', width: 20 },
            ]}
            rows={data.insurance.policies.map((p) => ({
              insurer: p.insurer,
              policy: p.policyNumber,
              nominee: p.nomineeName,
              relationship: p.nomineeRelationship,
              aligned: p.alignWithWill === null ? '—' : p.alignWithWill ? 'Yes' : 'No',
            }))}
          />
        </Section>
      </ReportPage>

      {/* Execution */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <Section title="Execution & Attesting Witnesses">
          <PdfCallout tone="info">
            Section 63 of the Indian Succession Act requires the testator's signature to be made or acknowledged in
            the presence of two witnesses present at the same time, who then each sign in the testator's presence.
            This must happen on the printed document — it cannot be completed digitally.
          </PdfCallout>
          <DataTable
            columns={[
              { key: 'name', label: 'Witness', width: 24 },
              { key: 'relationship', label: 'Relationship to testator', width: 22 },
              { key: 'id', label: 'ID number', width: 18 },
              { key: 'address', label: 'Address', width: 24 },
              { key: 'beneficiary', label: 'Also a beneficiary?', width: 12 },
            ]}
            rows={data.execution.witnesses
              .filter((w) => w.fullName)
              .map((w) => ({
                name: w.fullName,
                relationship: w.relationship,
                id: w.idNumber,
                address: w.address,
                beneficiary: w.isAlsoBeneficiary === null ? '—' : w.isAlsoBeneficiary ? 'Yes' : 'No',
              }))}
          />
          <Text style={{ fontSize: 7.5, color: pdfColors.muted, marginTop: 6 }}>
            {data.execution.isUttarakhandExecution
              ? 'Registration of this Will is mandatory under the Uttarakhand UCC framework.'
              : 'Registration under the Registration Act, 1908 is optional here, but recommended.'}
            {' '}
            {data.execution.plansVideoRecording ? 'The testator plans to videotape the signing.' : ''}
          </Text>
        </Section>

        <Section title="Funeral Wishes & Estate Settlement">
          <Text style={{ fontSize: 8.5, color: pdfColors.body, lineHeight: 1.5, marginBottom: 6 }}>
            {data.funeral.funeralWishes || 'No specific funeral wishes recorded.'}
          </Text>
          <PdfCallout tone={data.funeral.payExpensesFromEstate ? 'info' : 'warning'}>
            {data.funeral.payExpensesFromEstate
              ? 'Funeral costs, administrative expenses, and outstanding debts are to be paid from the estate before distribution.'
              : 'No instruction yet on paying funeral/administrative costs from the estate before distribution.'}
          </PdfCallout>
        </Section>
      </ReportPage>

      {/* Full draft */}
      <ReportPage clientName={data.personal.fullLegalName} planDate={planDate}>
        <Section title="Full Draft Document">
          <View style={draftStyles.draftBox}>
            {draftParagraphs.map((para, i) => {
              const [firstLine, ...rest] = para.split('\n')
              const firstLineIsHeading = firstLine === firstLine.toUpperCase() && firstLine.length < 40 && firstLine.length > 0
              return (
                <View key={i}>
                  {firstLineIsHeading && <Text style={draftStyles.draftHeading}>{firstLine}</Text>}
                  <Text style={draftStyles.draftParagraph}>{firstLineIsHeading ? rest.join('\n') : para}</Text>
                </View>
              )
            })}
          </View>
        </Section>

        {consultation && (
          <Section title="Legal Consultation Requested">
            <InfoGrid
              rows={[
                [
                  { label: 'Contact', value: consultation.contactName },
                  { label: 'Phone / email', value: consultation.contactPhone || consultation.contactEmail },
                  { label: 'Preferred mode', value: consultation.preferredMode },
                ],
                [{ label: 'Preferred window', value: consultation.preferredWindow }],
              ]}
            />
          </Section>
        )}

        <View style={disclaimerStyles.box}>
          <Text style={disclaimerStyles.text}>
            Disclaimer: This draft has been prepared based on information provided by {data.personal.fullLegalName || 'the client'}
            {' '}through Octaraa's Will drafting questionnaire. It is generated for review purposes and does not
            constitute legal advice, and is not a validly executed Will under the Indian Succession Act, 1925. The
            document must be reviewed by a qualified lawyer, then printed and signed by the testator in the
            simultaneous presence of two attesting witnesses who also sign, to have any legal effect. Octaraa does
            not accept liability for decisions made based solely on this document.
          </Text>
        </View>
      </ReportPage>
    </Document>
  )
}

function assignedNames(data: WillData, ids: string[] | undefined) {
  if (!ids?.length) return ''
  const titles = new Map(listAssets(data).map((asset) => [asset.id, asset.title]))
  return ids.map((id) => titles.get(id)).filter(Boolean).join('; ')
}
