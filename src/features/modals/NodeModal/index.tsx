import React, { useEffect, useMemo, useState } from "react";
import type { ModalProps } from "@mantine/core";
import {
  Modal,
  Stack,
  Text,
  ScrollArea,
  Flex,
  CloseButton,
  Button,
  Group,
  Textarea,
  Box,
} from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";

/**
 * return object from json removing array and object fields
 */
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) {
    // single primitive value - return as-is (string/number/boolean)
    // if it's a string, ensure it's quoted so editors show JSON string literal
    const v = nodeRows[0].value;
    if (typeof v === "string") return JSON.stringify(v);
    return `${v}`;
  }

  const obj: Record<string, unknown> = {};
  nodeRows?.forEach((row) => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map((seg) => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

/**
 * deep-sets value at JSON path (jsonc-parser style path: array of string|number)
 * Mutates the given object clone in-place and returns it.
 */
const setValueAtPath = (root: any, path: NodeData["path"] | undefined, value: any) => {
  if (!path || path.length === 0) {
    // replace root
    return value;
  }

  let cursor = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    // if segment is number, expect array
    if (typeof seg === "number") {
      if (!Array.isArray(cursor)) return null;
      cursor = cursor[seg];
    } else {
      if (cursor[seg] === undefined) cursor[seg] = {};
      cursor = cursor[seg];
    }
  }

  const last = path[path.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(cursor)) return null;
    cursor[last] = value;
  } else {
    cursor[last] = value;
  }

  return root;
};

/** shallow equality of JSONPath arrays */
const pathEquals = (a?: NodeData["path"], b?: NodeData["path"]) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph((state) => state.selectedNode);
  const setSelectedNode = useGraph((state) => state.setSelectedNode);
  const getNodes = useGraph((s) => s.nodes);
  const setGraphViewPort = useGraph((s) => s.setViewPort); // not used, but available
  const json = useJson((s) => s.getJson());
  const setJson = useJson((s) => s.setJson);

  const [editing, setEditing] = useState(false);
  const [editorValue, setEditorValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // when node changes, reset local editor state
  useEffect(() => {
    setEditing(false);
    setError(null);
    setEditorValue(normalizeNodeData(nodeData?.text ?? []));
  }, [nodeData?.id, opened]);

  const initialContent = useMemo(
    () => normalizeNodeData(nodeData?.text ?? []),
    [nodeData?.text]
  );

  // handle Save: update app JSON at node path and refresh graph
  const handleSave = () => {
    setError(null);

    // parse current app JSON
    let currentObj: any;
    try {
      currentObj = JSON.parse(json);
    } catch (err) {
      setError("Current JSON is invalid; cannot apply change.");
      return;
    }

    // determine new value from editor:
    let newValue: any;
    try {
      newValue = JSON.parse(editorValue);
    } catch {
      // fallback: treat as string (trim whitespace)
      newValue = editorValue;
    }

    // work on a deep clone to avoid accidental mutation of store object references
    let working = JSON.parse(JSON.stringify(currentObj));

    const updated = setValueAtPath(working, nodeData?.path, newValue);
    if (updated === null) {
      setError("Failed to set value at path (type mismatch).");
      return;
    }

    try {
      const newJsonString = JSON.stringify(updated, null, 2);
      setJson(newJsonString);

      // after setJson, graph is updated via useJson.setJson -> useGraph.setGraph
      // re-select the node with matching path after a short tick to allow graph update
      setTimeout(() => {
        const nodes = useGraph.getState().nodes;
        const found = nodes.find((n) => pathEquals(n.path, nodeData?.path));
        if (found) {
          useGraph.getState().setSelectedNode(found);
        } else {
          // nothing found; clear selection
          useGraph.getState().setSelectedNode(null as any);
        }
      }, 100);

      setEditing(false);
    } catch (err) {
      setError("Failed to save changes: " + (err as Error).message);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
    setEditorValue(initialContent);
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Flex gap="xs" align="center">
              {!editing ? (
                <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : (
                <Group gap="xs">
                  <Button size="xs" color="green" onClick={handleSave}>
                    Save
                  </Button>
                  <Button size="xs" variant="subtle" onClick={handleCancel}>
                    Cancel
                  </Button>
                </Group>
              )}
              <CloseButton onClick={onClose} />
            </Flex>
          </Flex>

          <ScrollArea.Autosize mah={250} maw={600}>
            {!editing ? (
              <CodeHighlight
                code={initialContent}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
                // keep monospace styling for clarity
                style={{ whiteSpace: "pre-wrap" }}
              />
            ) : (
              <Box miw={350} maw={600}>
                <Textarea
                  minRows={6}
                  autosize
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.currentTarget.value)}
                  styles={{
                    input: { fontFamily: "monospace", fontSize: 13 },
                  }}
                />
                {error ? (
                  <Text fz="xs" color="red" mt="xs">
                    {error}
                  </Text>
                ) : null}
              </Box>
            )}
          </ScrollArea.Autosize>
        </Stack>

        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};