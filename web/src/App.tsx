import { useEffect, useState } from 'react';
import { Badge, Container, Title } from '@mantine/core';
import { REGIONS } from '@app/shared';

// Step 1 placeholder: proves React + Mantine + the shared package + the /api proxy all work.
// The real chat UI is built in step 8.
export function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setStatus(r.ok ? 'ok' : 'down'))
      .catch(() => setStatus('down'));
  }, []);

  return (
    <Container py="xl">
      <Title order={2}>Travel Assistant</Title>
      <Badge mt="md" color={status === 'ok' ? 'green' : status === 'down' ? 'red' : 'gray'}>
        API: {status}
      </Badge>
      <Badge mt="md" ml="sm" variant="light">
        shared: {REGIONS.length} regions
      </Badge>
    </Container>
  );
}
