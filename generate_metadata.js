const fs = require('fs');
const path = require('path');

const data = {
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
  L3_Relationships: {
    headers: ["Parent Entity", "Child Entity", "Relationship"],
    rows: [
      ["Employee", "Employee Absence", "One-To-Many"],
      ["Department", "Employee", "One-To-Many"]
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
  <Author>Antigravity AI</Author>
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
