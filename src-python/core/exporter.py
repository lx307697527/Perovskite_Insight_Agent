import pandas as pd
import io
from sqlalchemy.orm import Session
from .database import Literature
import json


class DataExporter:
    def export_to_excel(self, db: Session, dois: list[str]) -> io.BytesIO:
        papers = db.query(Literature).filter(Literature.doi.in_(dois), Literature.is_extracted == True).all()

        export_data = []
        for paper in papers:
            perf = json.loads(paper.performance_data) if paper.performance_data else {}
            row = {
                "DOI": paper.doi,
                "Title": paper.title,
                "Journal": paper.journal,
                "Year": paper.year,
                "Composition": paper.composition,
                "Structure": paper.structure,
                "PCE (%)": perf.get("pce", "N/A"),
                "Voc (V)": perf.get("voc", "N/A"),
                "Jsc (mA/cm2)": perf.get("jsc", "N/A"),
                "FF (%)": perf.get("ff", "N/A"),
            }
            export_data.append(row)

        if not export_data:
            raise ValueError("No extracted data found for the selected papers")

        df = pd.DataFrame(export_data)

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='SIA_Data')

            worksheet = writer.sheets['SIA_Data']
            for idx, col in enumerate(df.columns):
                max_len = max(df[col].astype(str).map(len).max(), len(col)) + 2
                worksheet.column_dimensions[chr(65 + idx)].width = min(max_len, 50)

        output.seek(0)
        return output


exporter = DataExporter()
