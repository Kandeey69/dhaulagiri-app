import { memo } from "react";

type ReadOnlyFieldProps = {
  label: string;
  value: string;
};

function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return <label className="stock-field readonly"><span>{label}</span><strong>{value}</strong></label>;
}

export default memo(ReadOnlyField);
