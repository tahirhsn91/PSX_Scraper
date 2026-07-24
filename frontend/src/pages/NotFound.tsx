import { Typography, Button, Box } from '@mui/material';
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <Box textAlign="center" py={8}>
      <Typography variant="h4" gutterBottom>404 — Page not found</Typography>
      <Button component={Link} to="/" variant="contained">Back to Dashboard</Button>
    </Box>
  );
}
