import { ActionIcon, Button, Menu, Modal } from "@mantine/core";

export function SessionMenu({ hidden, onToggleHidden, onDelete }: { hidden: boolean; onToggleHidden: () => void; onDelete: () => void }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Session actions">
          <span className="text-lg leading-none text-bone-dim">⋯</span>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onToggleHidden}>{hidden ? "Show session" : "Hide session"}</Menu.Item>
        <Menu.Item color="red" onClick={onDelete}>
          Delete session
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function DeleteSessionModal({
  opened,
  lapCount,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  lapCount: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Delete session" centered>
      <p className="text-[14px] text-bone-dim">
        This removes the session, its {lapCount} laps and the raw telemetry file from disk. It cannot be undone. Hide the session
        instead to keep the data but leave it out of your analysis.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button color="red" onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}
