import { Button, Box } from '@mui/material';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';

export function NotFound() {
  return (
    <Box>
      <PageHeader title="Page not found" crumbs={[{ label: 'Dashboard', to: '/' }, { label: '404' }]} />
      <SectionCard>
        <StatePanel
          kind="empty"
          icon={<SearchOffRoundedIcon fontSize="inherit" />}
          title="We could not find that page"
          description="The link may be out of date, or that stock is not tracked yet. Try searching for the symbol."
          action={
            <Button component={RouterLink} to="/" variant="contained">
              Back to dashboard
            </Button>
          }
        />
      </SectionCard>
    </Box>
  );
}
