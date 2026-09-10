package com.project.platform.offloading;

import com.project.platform.runtime.model.WorkflowException;

/** Row-major Linear/ReLU/Linear network exported by the offline trainer. No built-in weights. */
public record DqnModel(String stateSchema,double[][] weights1,double[] bias1,double[][] weights2,double[] bias2) {
    public static final String SCHEMA="terminal-slot-cost-v1";
    public static final int FEATURES=13;
    public void validate() {
        if(!SCHEMA.equals(stateSchema) || bias1==null || bias1.length<1 || bias1.length>128
                || bias2==null || bias2.length!=3)throw invalid();
        matrix(weights1,bias1.length,FEATURES);matrix(weights2,3,bias1.length);finite(bias1);finite(bias2);
    }
    public double[] predict(double[] state) {
        validate();if(state==null || state.length!=FEATURES)throw invalid();finite(state);
        double[] hidden=new double[bias1.length],q=bias2.clone();
        for(int h=0;h<hidden.length;h++){double value=bias1[h];for(int i=0;i<FEATURES;i++)value+=weights1[h][i]*state[i];hidden[h]=Math.max(0,value);}
        for(int a=0;a<3;a++)for(int h=0;h<hidden.length;h++)q[a]+=weights2[a][h]*hidden[h];
        finite(q);return q;
    }
    public int choose(double[] state) {
        double[] q=predict(state);int selected=-1;
        for(int a=0;a<3;a++)if(state[1+a*4]==1 && (selected<0 || q[a]>q[selected]))selected=a;
        if(selected<0)throw WorkflowException.invalid("offload","no eligible execution target");return selected;
    }
    private static void matrix(double[][] value,int rows,int columns) {
        if(value==null || value.length!=rows)throw invalid();
        for(double[] row:value){if(row==null || row.length!=columns)throw invalid();finite(row);}
    }
    private static void finite(double[] values){for(double v:values)if(!Double.isFinite(v) || Math.abs(v)>1e6)throw invalid();}
    private static WorkflowException invalid(){return WorkflowException.invalid("model","expected finite terminal-slot-cost-v1 network: 13 inputs, 1..128 hidden units, 3 actions");}
}
