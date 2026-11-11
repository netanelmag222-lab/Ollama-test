import { SharePointService } from '../logic/sp';

export interface IMorningChecksProps {
  sp: SharePointService;
  userDisplayName: string;
  userEmail: string;
  canManage: boolean;      // can create lists (site owner); shows the Setup button
  summaryTo: string;       // semicolon-separated recipients for the daily summary
}
