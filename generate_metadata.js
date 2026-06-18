const fs = require('fs');
const path = require('path');

const data = {
  L1_Source_Connections: {
    headers: ["System ID", "System Name", "System Type", "Host/Endpoint", "Source DB/Schema", "Extract Frequency", "Extraction Method"],
    rows: [
      ["S01", "Salesforce", "Cloud API", "api.salesforce.com", "SF_PRODUCTION", "Daily", "Incremental CDC"],
      ["S02", "Epicor", "MS SQL Server", "10.0.1.45", "ERP_LIVE.DBO", "Hourly", "Transaction Log Sync"],
      ["S03", "Priority", "Oracle Database", "10.0.1.60", "PR_PROD.DBO", "Daily", "Full Load"],
      ["S04", "SAP", "SAP HANA", "hana-prod.sap.internal", "S4H.SCHEMA", "Real-time", "SLT Replication"],
      ["S05", "Snowflake", "Snowflake DWH", "xy12345.snowflakecomputing.com", "RAW_STAGE", "Hourly", "Snowpipe"]
    ]
  },
  L1_Physical_Metadata: {
    headers: ["Source System", "Object", "Column", "Datatype"],
    rows: [
      ["Salesforce", "ABSENTCHART", "EMP_ID", "NUMBER"],
      ["Salesforce", "ABSENTCHART", "ABSENCE_DATE", "DATE"],
      ["Salesforce", "ABSENTCHART", "ABSENCE_REASON", "VARCHAR"],
      ["Epicor", "HR_ABSENCE", "EMPLOYEE_NUM", "INTEGER"],
      ["Epicor", "HR_ABSENCE", "ABS_DATE", "DATE"],
      ["Priority", "EMP_ABS", "EMP_NO", "VARCHAR"],
      ["Priority", "EMP_ABS", "LEAVE_DT", "DATE"],
      ["SAP", "PA2001", "PERNR", "NUMC"],
      ["SAP", "PA2001", "ABWTG", "DATS"],
      ["Snowflake", "FCT_REVENUE", "EMPLOYEE_ID", "INTEGER"],
      ["Snowflake", "FCT_REVENUE", "NET_AMOUNT", "NUMBER"]
    ]
  },
  L2_Standardized_Attributes: {
    headers: ["Salesforce Column", "Epicor Column", "Priority Column", "SAP Column", "Snowflake Column", "Standard Business Attribute", "Datatype", "Confidence", "Reviewed By"],
    rows: [
      ["ABSENCE_DATE", "ABS_DATE", "LEAVE_DT", "ABWTG", "ABSENCE_DATE", "Absence Date", "DATE", "high", "catalog-steward@anvizent.com"],
      ["EMP_ID", "EMPLOYEE_NUM", "EMP_NO", "PERNR", "EMPLOYEE_ID", "Employee ID", "INTEGER", "high", "catalog-steward@anvizent.com"],
      ["AMOUNT", "INVOICE_AMT", "INV_AMT", "WRBTR", "NET_AMOUNT", "Revenue Amount", "DECIMAL", "high", "catalog-steward@anvizent.com"],
      ["DEPT_NAME", "DEPT_DESC", "DEPT_NM", "IDGEH", "DEPARTMENT_NAME", "Department Name", "VARCHAR", "high", "catalog-steward@anvizent.com"],
      ["SKU_QTY", "STOCK_QTY", "QTY_ON_HAND", "LABST", "ON_HAND_QTY", "Inventory On-Hand Quantity", "INTEGER", "high", "catalog-steward@anvizent.com"]
    ]
  },
  L3_Glossary: {
    headers: ["Term", "Definition", "Business Domain"],
    rows: [
      ["Employee", "Individual employed by the organization", "Human Resources"],
      ["Absence", "Period when an employee is unavailable for scheduled work", "Human Resources"],
      ["Revenue", "Inflow of economic benefits from primary sales activities", "Finance"],
      ["Discount", "Reduction in the standard price of goods or services", "Sales"],
      ["Inventory", "Stock of raw materials, work-in-progress, or finished goods", "Inventory"]
    ]
  },
  L3_Synonyms: {
    headers: ["Canonical Term", "Synonyms"],
    rows: [
      ["Employee", "Worker, Associate, Staff, Personnel"],
      ["Revenue", "Sales, Turnover, Earnings, Income"],
      ["Absence", "Leave, Time Off, Sick Day, Absenteeism"],
      ["Discount", "Markdown, Rebate, Price Reduction"],
      ["Department", "Division, Unit, Org Unit, Branch"]
    ]
  },
  L3_Semantic_Entities: {
    headers: ["Entity ID", "Entity Name", "Domain"],
    rows: [
      ["1001", "Employee Absence", "Human Resources"],
      ["1002", "Employee", "Human Resources"],
      ["1003", "Department", "Human Resources"],
      ["1004", "Revenue", "Finance"],
      ["1005", "Opportunity", "Sales"],
      ["1006", "Discount", "Sales"],
      ["1007", "Inventory Position", "Inventory"]
    ]
  },
  L3_Source_Mappings: {
    headers: ["Entity Name", "Source System", "Physical Object"],
    rows: [
      ["Employee Absence", "Salesforce", "ABSENTCHART"],
      ["Employee Absence", "Epicor", "HR_ABSENCE"],
      ["Employee Absence", "Priority", "EMP_ABS"],
      ["Employee Absence", "SAP", "PA2001"],
      ["Employee Absence", "Databricks", "DM_EMPLOYEE_ABSENCE"],
      ["Revenue", "Salesforce", "OPPORTUNITY"],
      ["Revenue", "Snowflake", "FCT_REVENUE"],
      ["Revenue", "Databricks", "DM_REVENUE"],
      ["Inventory Position", "Databricks", "DM_INVENTORY_POSITION"]
    ]
  },
  L3_Metrics: {
    headers: ["Metric Name", "Entity Name", "Aggregation"],
    rows: [
      ["Absence Count", "Employee Absence", "COUNT"],
      ["Revenue", "Revenue", "SUM"],
      ["Employee Count", "Employee", "COUNT"],
      ["Discount Rate", "Discount", "AVG"],
      ["On-Hand Quantity", "Inventory Position", "SUM"]
    ]
  },
  L3_Metric_Mappings: {
    headers: ["Metric Name", "Source System", "Object", "Column", "Aggregation"],
    rows: [
      ["Absence Count", "Salesforce", "ABSENTCHART", "ABSENCE_ID", "COUNT"],
      ["Absence Count", "Epicor", "HR_ABSENCE", "ABS_ID", "COUNT"],
      ["Absence Count", "Priority", "EMP_ABS", "ABSENCE_NO", "COUNT"],
      ["Absence Count", "Databricks", "DM_EMPLOYEE_ABSENCE", "ABSENCE_COUNT", "SUM"],
      ["Revenue", "Salesforce", "OPPORTUNITY", "AMOUNT", "SUM"],
      ["Revenue", "Databricks", "DM_REVENUE", "REVENUE_AMOUNT", "SUM"],
      ["On-Hand Quantity", "Databricks", "DM_INVENTORY_POSITION", "ON_HAND_QTY", "SUM"]
    ]
  },
  L3_KPI_Definitions: {
    headers: ["Metric", "Formula", "Grain"],
    rows: [
      ["Absence Count", "COUNT(absence_id)", "Daily"],
      ["Revenue", "SUM(invoice_amount)", "Monthly"],
      ["Employee Count", "COUNT(DISTINCT employee_id)", "Daily"],
      ["Discount Rate", "AVG(discount_percentage)", "Monthly"],
      ["On-Hand Quantity", "SUM(qty_on_hand)", "Daily"]
    ]
  },
  L3_Business_Rules: {
    headers: ["Rule ID", "Entity", "Rule Name", "Rule Logic"],
    rows: [
      ["BR001", "Employee Absence", "Valid Absence", "absence_hours > 0"],
      ["BR002", "Revenue", "Net Revenue", "gross_revenue - tax"],
      ["BR003", "Discount", "High Discount Flag", "discount_rate > 0.15"],
      ["BR004", "Inventory Position", "Out of Stock Flag", "on_hand_quantity == 0"]
    ]
  },
  L3_Relationships: {
    headers: ["Parent Entity", "Child Entity", "Relationship"],
    rows: [
      ["Employee", "Employee Absence", "One-To-Many"],
      ["Department", "Employee", "One-To-Many"]
    ]
  },
  L3_Data_Quality_Rules: {
    headers: ["Entity", "Attribute", "Rule"],
    rows: [
      ["Employee", "Employee ID", "Not Null"],
      ["Employee", "Email", "Valid Email Format"],
      ["Revenue", "Amount", "> 0"],
      ["Discount", "Discount Rate", "Between 0 and 1"],
      ["Inventory Position", "On-Hand Quantity", ">= 0"]
    ]
  },
  DWH_Dimensions_Facts: {
    headers: ["Table Name", "Table Type", "Column Name", "Is Primary Key", "Is Foreign Key", "Referenced Table", "Datatype", "Description"],
    rows: [
      ["dim_employee", "Dimension", "employee_key", "Yes", "No", "", "INTEGER", "Surrogate primary key for employee dimension"],
      ["dim_employee", "Dimension", "source_system", "No", "No", "", "VARCHAR", "System from which the record was extracted"],
      ["dim_employee", "Dimension", "employee_id", "No", "No", "", "VARCHAR", "Source system employee unique ID"],
      ["dim_employee", "Dimension", "employee_name", "No", "No", "", "VARCHAR", "Full name of the employee"],
      ["dim_employee", "Dimension", "email", "No", "No", "", "VARCHAR", "Corporate email address"],
      ["dim_department", "Dimension", "department_key", "Yes", "No", "", "INTEGER", "Surrogate primary key for department"],
      ["dim_department", "Dimension", "department_name", "No", "No", "", "VARCHAR", "Standardized department name"],
      ["fct_absences", "Fact", "absence_key", "Yes", "No", "", "INTEGER", "Surrogate key for facts"],
      ["fct_absences", "Fact", "employee_key", "No", "Yes", "dim_employee", "INTEGER", "FK linking to employee dimension"],
      ["fct_absences", "Fact", "department_key", "No", "Yes", "dim_department", "INTEGER", "FK linking to department dimension"],
      ["fct_absences", "Fact", "absence_date", "No", "No", "", "DATE", "Calendar date of the absence"],
      ["fct_absences", "Fact", "absence_count", "No", "No", "", "INTEGER", "Absence unit count (1 for full day, etc.)"],
      ["fct_revenue", "Fact", "revenue_key", "Yes", "No", "", "INTEGER", "Surrogate key for revenue entries"],
      ["fct_revenue", "Fact", "department_key", "No", "Yes", "dim_department", "INTEGER", "FK linking to department dimension"],
      ["fct_revenue", "Fact", "revenue_amount", "No", "No", "", "DECIMAL", "Transactional revenue amount"],
      ["fct_revenue", "Fact", "posting_date", "No", "No", "", "DATE", "Financial ledger post date"]
    ]
  },
  DM_Data_Marts: {
    headers: ["Mart Name", "Target View/Table", "Column Name", "Source DWH Fields", "Aggregation / Formula", "Business Owner"],
    rows: [
      ["dm_employee_absence", "v_dm_employee_absence", "department_name", "dim_department.department_name", "None (Group By)", "HR Analytics Team"],
      ["dm_employee_absence", "v_dm_employee_absence", "absence_date", "fct_absences.absence_date", "None (Group By)", "HR Analytics Team"],
      ["dm_employee_absence", "v_dm_employee_absence", "total_absences", "fct_absences.absence_count", "SUM(absence_count)", "HR Analytics Team"],
      ["dm_employee_absence", "v_dm_employee_absence", "active_employee_count", "dim_employee.employee_key", "COUNT(DISTINCT employee_key)", "HR Analytics Team"],
      ["dm_revenue", "v_dm_revenue", "department_name", "dim_department.department_name", "None (Group By)", "Finance Controlling"],
      ["dm_revenue", "v_dm_revenue", "fiscal_period", "dim_date.fiscal_period", "None (Group By)", "Finance Controlling"],
      ["dm_revenue", "v_dm_revenue", "total_revenue", "fct_revenue.revenue_amount", "SUM(revenue_amount)", "Finance Controlling"]
    ]
  },
  ETL_Lineage_Jobs: {
    headers: ["Job ID", "Job Name", "Source Table/Object", "Transformation Layer", "Target DWH Table", "Dependency", "Load Type"],
    rows: [
      ["J01", "extract_sfdc_absences", "Salesforce.ABSENTCHART", "L1 Raw Ingestion", "stg_sf_absences", "None", "Incremental"],
      ["J02", "extract_sap_absences", "SAP.PA2001", "L1 Raw Ingestion", "stg_sap_absences", "None", "Incremental"],
      ["J03", "load_dim_employee", "stg_sf_employees, stg_sap_employees", "DWH Core Dim", "dim_employee", "J01, J02", "UPSERT (SCD Type 1)"],
      ["J04", "load_dim_department", "stg_sf_departments", "DWH Core Dim", "dim_department", "None", "Full Refresh"],
      ["J05", "load_fct_absences", "stg_sf_absences, stg_sap_absences", "DWH Core Fact", "fct_absences", "J03, J04", "Incremental APPEND"],
      ["J06", "load_fct_revenue", "stg_sf_opportunity, stg_sap_ledger", "DWH Core Fact", "fct_revenue", "J04", "Incremental APPEND"],
      ["J07", "refresh_dm_employee_absence", "dim_employee, dim_department, fct_absences", "Data Mart View", "dm_employee_absence", "J05", "On-Demand Refresh"],
      ["J08", "refresh_dm_revenue", "dim_department, fct_revenue", "Data Mart View", "dm_revenue", "J06", "On-Demand Refresh"]
    ]
  }
};

function generateXMLSpreadsheet(data) {
  let xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>Anvizent Engineer</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center" ss:Horizontal="Center"/>
  </Style>
  <Style ss:ID="DataStyle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
 </Styles>
`;

  for (const [sheetName, sheetData] of Object.entries(data)) {
    xml += ` <Worksheet ss:Name="${sheetName}">
  <Table>
   <Row ss:Height="22" ss:StyleID="HeaderStyle">
`;
    for (const header of sheetData.headers) {
      xml += `    <Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>\n`;
    }
    xml += `   </Row>\n`;

    for (const row of sheetData.rows) {
      xml += `   <Row ss:Height="18" ss:StyleID="DataStyle">\n`;
      for (const cell of row) {
        const type = isNaN(cell) || cell === "" ? "String" : "Number";
        xml += `    <Cell><Data ss:Type="${type}">${escapeXml(cell)}</Data></Cell>\n`;
      }
      xml += `   </Row>\n`;
    }

    xml += `  </Table>
 </Worksheet>\n`;
  }

  xml += `</Workbook>\n`;
  return xml;
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

const outputPath = path.join(__dirname, 'semantic_metadata_catalog.xls');
fs.writeFileSync(outputPath, generateXMLSpreadsheet(data), 'utf-8');
console.log(`Successfully generated multi-sheet Excel file at: ${outputPath}`);
