import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Version } from '@microsoft/sp-core-library';
import { type IPropertyPaneConfiguration, PropertyPaneTextField } from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { SPPermission } from '@microsoft/sp-page-context';

import * as strings from 'MorningChecksWebPartStrings';
import MorningChecks from './components/MorningChecks';
import { IMorningChecksProps } from './components/IMorningChecksProps';
import { SharePointService } from './logic/sp';

export interface IMorningChecksWebPartProps {
  summaryTo: string;
}

export default class MorningChecksWebPart extends BaseClientSideWebPart<IMorningChecksWebPartProps> {
  private _root: Root | undefined;
  private _sp: SharePointService | undefined;

  public render(): void {
    if (!this._sp) this._sp = new SharePointService(this.context.spHttpClient, this.context.pageContext.web.absoluteUrl);
    const user = this.context.pageContext.user;
    const element: React.ReactElement<IMorningChecksProps> = React.createElement(MorningChecks, {
      sp: this._sp,
      userDisplayName: user.displayName,
      userEmail: user.email || user.loginName || '',
      canManage: this.context.pageContext.web.permissions.hasPermission(SPPermission.manageLists),
      summaryTo: this.properties.summaryTo || ''
    });
    if (!this._root) this._root = createRoot(this.domElement);
    this._root.render(element);
  }

  protected onDispose(): void {
    this._root?.unmount();
    this._root = undefined;
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [{
        header: { description: strings.PropertyPaneDescription },
        groups: [{
          groupName: strings.BasicGroupName,
          groupFields: [PropertyPaneTextField('summaryTo', { label: strings.SummaryToLabel, description: strings.SummaryToHelp })]
        }]
      }]
    };
  }
}
