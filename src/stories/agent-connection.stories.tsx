import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { expect, userEvent, within } from 'storybook/test'

import { AgentConnection } from '../viewer/agent-connection'

const meta: Meta<typeof AgentConnection> = {
  title: 'Viewer/AgentConnection',
  component: AgentConnection,
  parameters: {
    layout: 'centered',
  },
  tags: ['ai-generated'],
}

export default meta

type Story = StoryObj<typeof AgentConnection>

export const Default: Story = {}

export const OpensDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Connect an agent' })
    await userEvent.click(trigger)
    const dialog = await within(document.body).findByRole('dialog')
    expect(within(dialog).getByText('Connect an agent')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Claude/ })).toBeInTheDocument()
  },
}

export const ShowsClientDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Connect an agent' }))
    const dialog = await within(document.body).findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /Claude Code/ }))
    expect(await within(dialog).findByText(/\/api\/mcp/)).toBeInTheDocument()
  },
}
