export const mockUser = {
  id: 'user-1',
  name: 'Pranav',
  email: 'pranav@aromazen.com',
  department: 'AI Labs',
  role: 'Senior AI Scientist',
  avatar: 'PR',
}

export const mockCollections = [
  { id: 'shared', name: 'Shared', icon: 'Share2', scope: 'Company-wide', docs: 234, lastUpdate: '2 hours ago' },
  { id: 'production', name: 'Production', icon: 'Factory', scope: 'Production Team', docs: 156, lastUpdate: '4 hours ago' },
  { id: 'rnd', name: 'R&D', icon: 'FlaskConical', scope: 'R&D Team', docs: 287, lastUpdate: '1 day ago' },
  { id: 'marketing', name: 'Marketing', icon: 'Megaphone', scope: 'Marketing Team', docs: 92, lastUpdate: '2 days ago' },
  { id: 'accounts', name: 'Accounts & HR', icon: 'Users', scope: 'Finance & HR', docs: 45, lastUpdate: '3 days ago' },
]

export const mockDocuments = [
  { id: 'doc-1', name: 'IFRA_Q1_2025_Guidelines.pdf', collection: 'Production', uploader: 'Sarah Chen', status: 'Indexed' as const, version: 'v2.1', date: '2025-01-15' },
  { id: 'doc-2', name: 'Batch_Mixing_SOP_Rev47.docx', collection: 'Production', uploader: 'Marcus Rodriguez', status: 'Indexed' as const, version: 'v1.0', date: '2025-01-14' },
  { id: 'doc-3', name: 'Marketing_Campaign_Strategy.pptx', collection: 'Marketing', uploader: 'Emma Watson', status: 'Processing' as const, version: 'v1.2', date: '2025-01-13' },
  { id: 'doc-4', name: 'Fragrance_Ingredient_Comparison.xlsx', collection: 'R&D', uploader: 'David Kim', status: 'Failed' as const, version: 'v1.0', date: '2025-01-13' },
  { id: 'doc-5', name: 'Product_Line_Overview_2025.pdf', collection: 'Shared', uploader: 'Jessica Park', status: 'Indexed' as const, version: 'v3.2', date: '2025-01-12' },
]

export const mockTeamUsers = [
  { id: 'user-1', name: 'Pranav Raok', department: 'AI Labs', role: 'Senior AI Scientist', status: 'Active' as const, lastActive: '5 minutes ago' },
  { id: 'user-2', name: 'Sarah Chen', department: 'R&D', role: 'Research Lead', status: 'Active' as const, lastActive: '12 minutes ago' },
  { id: 'user-3', name: 'Marcus Rodriguez', department: 'Production', role: 'Production Manager', status: 'Active' as const, lastActive: '1 hour ago' },
  { id: 'user-4', name: 'Emma Watson', department: 'Marketing', role: 'Marketing Manager', status: 'Invited' as const, lastActive: 'Never' },
  { id: 'user-5', name: 'David Kim', department: 'R&D', role: 'Chemist', status: 'Active' as const, lastActive: '3 hours ago' },
  { id: 'user-6', name: 'Yuki Tanaka', department: 'AI Labs', role: 'ML Engineer', status: 'Disabled' as const, lastActive: '5 days ago' },
]

export const mockRoles = [
  { id: 'owner', name: 'Super Admin', description: 'Full platform control and highest-level administration' },
  { id: 'super-admin', name: 'Admin', description: 'Manage organization users and settings' },
  { id: 'dept-admin', name: 'Department Admin', description: 'Manage department access' },
  { id: 'employee', name: 'Employee', description: 'Standard employee access' },
]

export const mockUsageData = {
  currentMonth: { cost: '₹11,17,732.50', requests: 18523, inputTokens: 2847392, outputTokens: 1523847 },
  costByDepartment: [
    { department: 'R&D', cost: 4240, requests: 6234 },
    { department: 'Production', cost: 3580, requests: 5126 },
    { department: 'Marketing', cost: 2360, requests: 3412 },
    { department: 'Creation Labs', cost: 1840, requests: 2651 },
    { department: 'Sourcing', cost: 827, requests: 1100 },
  ],
  employeeUsage: [
    { name: 'Sarah Chen', department: 'R&D', model: 'GPT-4', requests: 342, cost: '₹25,008.15' },
    { name: 'Marcus Rodriguez', department: 'Production', model: 'GPT-4', requests: 298, cost: '₹21,854.40' },
    { name: 'Pranav Raok', department: 'AI Labs', model: 'GPT-4', requests: 267, cost: '₹19,561.95' },
    { name: 'Emma Watson', department: 'Marketing', model: 'GPT-3.5', requests: 189, cost: '₹3,942.84' },
    { name: 'David Kim', department: 'R&D', model: 'GPT-4', requests: 156, cost: '₹11,431.80' },
  ],
}

export const mockChatHistory = [
  { id: 'chat-1', title: 'IFRA Document Analysis', date: '2025-01-15', collection: 'Production' },
  { id: 'chat-2', title: 'Production SOP Summary', date: '2025-01-14', collection: 'Production' },
  { id: 'chat-3', title: 'Ingredient Comparison', date: '2025-01-12', collection: 'R&D' },
]

export const mockChatMessages = [
  {
    id: 'msg-1',
    role: 'user' as const,
    content: 'Summarize the key points from the IFRA Q1 2025 guidelines document',
    timestamp: new Date(Date.now() - 600000),
  },
  {
    id: 'msg-2',
    role: 'assistant' as const,
    content: `The IFRA Q1 2025 guidelines introduce several key changes:

1. **New Fragrance Restrictions**: Three previously approved ingredients now require additional safety testing
2. **Documentation Requirements**: Enhanced traceability requirements for all imported raw materials
3. **Concentration Limits**: Updated maximum concentration levels for volatile organic compounds
4. **Timeline**: All facilities must comply by March 31, 2025`,
    sources: [
      { name: 'IFRA_Q1_2025_Guidelines.pdf', page: 1, collection: 'Production', relevance: 0.98 },
      { name: 'IFRA_Q1_2025_Guidelines.pdf', page: 3, collection: 'Production', relevance: 0.95 },
    ],
    timestamp: new Date(Date.now() - 300000),
  },
]

export const mockPromptSuggestions = [
  { icon: 'FileText', text: 'Summarise this IFRA document' },
  { icon: 'ClipboardList', text: 'Find the production SOP for batch mixing' },
  { icon: 'Sparkles', text: 'Create a product brochure outline' },
  { icon: 'Scale', text: 'Compare two fragrance ingredients' },
]
