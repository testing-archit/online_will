export const RELIGION_LABEL: Record<string, string> = {
  hindu: 'Hindu',
  muslim: 'Muslim',
  christian: 'Christian',
  parsi: 'Parsi',
  sikh: 'Sikh',
  jain: 'Jain',
  buddhist: 'Buddhist',
  other: 'Other',
}

export const RELATIONSHIP_LABEL: Record<string, string> = {
  spouse: 'Spouse',
  child: 'Child',
  parent: 'Parent',
  other: 'Other (non-heir)',
}

export const DISTRIBUTION_SCHEME_LABEL: Record<string, string> = {
  'all-in-one': 'All-in-one',
  itemized: 'Itemized (specific bequests)',
  percentage: 'Percentage / share-based',
}

export const DEBT_SETTLEMENT_LABEL: Record<string, string> = {
  'specific-asset': 'From the specific encumbered asset',
  'estate-reserves': 'From general estate cash reserves',
  'before-distribution': 'Prior to any distribution',
}

export const COMPENSATION_LABEL: Record<string, string> = {
  compensated: 'Compensated from estate',
  uncompensated: 'Serves without remuneration',
}
