package com.project.platform.offloading;

import com.project.platform.runtime.model.WorkflowException;

/** Row-major Linear/ReLU/Linear network exported by the offline trainer. No built-in weights. */
public record DqnModel(String stateSchema,double[][] weights1,double[] bias1,double[][] weights2,double[] bias2) {
    public static final String SCHEMA="measured-offload-log1p-v1";
    public static final int FEATURES=6;
    public void validate() {
        if(!SCHEMA.equals(stateSchema) || bias1==null || bias1.length<1 || bias1.length>128
                || bias2==null || bias2.length!=3)throw invalid();
        matrix(weights1,bias1.length,FEATURES);matrix(weights2,3,bias1.length);finite(bias1);finite(bias2);
    }
    private static void matrix(double[][] value,int rows,int columns) {
        if(value==null || value.length!=rows)throw invalid();
        for(double[] row:value){if(row==null || row.length!=columns)throw invalid();finite(row);}
    }
    private static void finite(double[] values){for(double v:values)if(!Double.isFinite(v) || Math.abs(v)>1e6)throw invalid();}
    private static WorkflowException invalid(){return WorkflowException.invalid("model","expected finite measured-offload-log1p-v1 network: 6 inputs, 1..128 hidden units, 3 actions");}
}
